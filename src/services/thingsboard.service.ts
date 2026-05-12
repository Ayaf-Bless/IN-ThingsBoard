import axios from 'axios';
import { apiClient, formatAxiosError } from './api-client';
import { config } from '../config';
import { Asset, AssetInfo, Customer, PageData, Relation } from '../types/thingsboard';
import { createLimiter, mapWithConcurrency } from '../utils/async';

const NULL_UUID = '13814000-1dd2-11b2-8080-808080808080';
type StatusLogger = (message: string) => void;

interface TraversalStats {
  relationRequests: number;
  relationCacheHits: number;
  subtreeCacheHits: number;
  cachedSubtrees: number;
}

export class ThingsBoardService {
  private relationsFromCache = new Map<string, Promise<Relation[]>>();
  private descendantDeviceCache = new Map<string, Promise<string[]>>();
  private readonly relationRequestLimiter = createLimiter(config.relationConcurrency);
  private relationRequests = 0;
  private relationCacheHits = 0;
  private subtreeCacheHits = 0;

  resetTraversalState(): void {
    this.relationsFromCache.clear();
    this.descendantDeviceCache.clear();
    this.relationRequests = 0;
    this.relationCacheHits = 0;
    this.subtreeCacheHits = 0;
  }

  getTraversalStats(): TraversalStats {
    return {
      relationRequests: this.relationRequests,
      relationCacheHits: this.relationCacheHits,
      subtreeCacheHits: this.subtreeCacheHits,
      cachedSubtrees: this.descendantDeviceCache.size,
    };
  }

  private async getAllPages<T>(path: string, pageSize = 100, label = 'records', onStatus?: StatusLogger): Promise<T[]> {
    let records: T[] = [];
    let hasNext = true;
    let page = 0;

    while (hasNext) {
      const response = await apiClient.get<PageData<T>>(path, {
        params: { pageSize, page },
      });
      records = records.concat(response.data.data);
      hasNext = response.data.hasNext;
      onStatus?.(`Loaded ${label} page ${page + 1} with ${response.data.data.length} items (${records.length} total so far).`);
      page++;
    }

    return records;
  }

  async getAllAssetInfos(pageSize = 100, onStatus?: StatusLogger): Promise<AssetInfo[]> {
    try {
      onStatus?.('Trying the metadata-rich /api/tenant/assetInfos endpoint first.');
      return await this.getAllPages<AssetInfo>('/api/tenant/assetInfos', pageSize, 'asset metadata', onStatus);
    } catch (error) {
      if (!this.shouldFallbackToTenantAssets(error)) {
        throw error;
      }

      onStatus?.(
        `AssetInfo endpoint unavailable. Falling back to /api/tenant/assets and hydrating customer names manually. Reason: ${formatAxiosError(error)}`
      );

      const assets = await this.getAllPages<Asset>('/api/tenant/assets', pageSize, 'assets', onStatus);
      return this.hydrateAssetsWithCustomerTitles(assets, onStatus);
    }
  }

  private shouldFallbackToTenantAssets(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return status === 400 || status === 404;
  }

  private async hydrateAssetsWithCustomerTitles(assets: Asset[], onStatus?: StatusLogger): Promise<AssetInfo[]> {
    const customerTitleMap = await this.getCustomerTitleMap(assets, onStatus);

    return assets.map((asset) => ({
      ...asset,
      customerTitle: customerTitleMap.get(asset.customerId?.id) || 'Tenant Asset',
    }));
  }

  private async getCustomerTitleMap(assets: Asset[], onStatus?: StatusLogger): Promise<Map<string, string>> {
    const customerIds = [
      ...new Set(
        assets
          .map((asset) => asset.customerId?.id)
          .filter((customerId): customerId is string => Boolean(customerId) && customerId !== NULL_UUID)
      ),
    ];

    onStatus?.(`Resolving ${customerIds.length} unique customers to rebuild the missing asset metadata.`);

    let resolvedCustomers = 0;
    const customers = await mapWithConcurrency(customerIds, config.relationConcurrency, async (customerId) => {
      try {
        const response = await apiClient.get<Customer>(`/api/customer/${customerId}`);
        const title = response.data.title || response.data.name || 'Unknown Customer';
        return [customerId, title] as const;
      } catch (error) {
        console.warn(`Failed to load customer ${customerId}: ${formatAxiosError(error)}`);
        return [customerId, 'Unknown Customer'] as const;
      } finally {
        resolvedCustomers++;
        if (resolvedCustomers === customerIds.length || resolvedCustomers % 25 === 0) {
          onStatus?.(`Resolved ${resolvedCustomers}/${customerIds.length} customers.`);
        }
      }
    });

    return new Map(customers);
  }

  async getDescendantDeviceIds(assetId: string, relationType = 'Contains', visited = new Set<string>()): Promise<string[]> {
    if (visited.has(assetId)) {
      return [];
    }

    const cachedSubtree = this.descendantDeviceCache.get(assetId);
    if (cachedSubtree) {
      this.subtreeCacheHits++;
      return cachedSubtree;
    }

    const nextVisited = new Set(visited);
    nextVisited.add(assetId);

    const subtreePromise = this.collectDescendantDeviceIds(assetId, relationType, nextVisited).catch((error) => {
      this.descendantDeviceCache.delete(assetId);
      throw error;
    });

    this.descendantDeviceCache.set(assetId, subtreePromise);
    return subtreePromise;
  }

  private async collectDescendantDeviceIds(
    assetId: string,
    relationType: string,
    visited: Set<string>
  ): Promise<string[]> {
    const relations = await this.getRelationsFromCached(assetId, 'ASSET');
    const directDeviceIds = new Set<string>();
    const childAssetIds = new Set<string>();

    for (const relation of relations) {
      if (relation.type !== relationType) {
        continue;
      }

      if (relation.to.entityType === 'DEVICE') {
        directDeviceIds.add(relation.to.id);
        continue;
      }

      if (relation.to.entityType === 'ASSET' && !visited.has(relation.to.id)) {
        childAssetIds.add(relation.to.id);
      }
    }

    const descendantDeviceLists = await Promise.all(
      [...childAssetIds].map((childAssetId) => this.getDescendantDeviceIds(childAssetId, relationType, visited))
    );

    for (const descendantDevices of descendantDeviceLists) {
      for (const deviceId of descendantDevices) {
        directDeviceIds.add(deviceId);
      }
    }

    return [...directDeviceIds].sort();
  }

  private async getRelationsFromCached(fromId: string, fromType: string): Promise<Relation[]> {
    const cacheKey = `${fromType}:${fromId}`;
    const cachedRelations = this.relationsFromCache.get(cacheKey);

    if (cachedRelations) {
      this.relationCacheHits++;
      return cachedRelations;
    }

    const request = this.relationRequestLimiter(async () => {
      this.relationRequests++;
      return this.getRelationsFrom(fromId, fromType);
    }).catch((error) => {
      this.relationsFromCache.delete(cacheKey);
      throw error;
    });

    this.relationsFromCache.set(cacheKey, request);
    return request;
  }

  async getRelationsFrom(fromId: string, fromType: string): Promise<Relation[]> {
    const response = await apiClient.get<Relation[]>('/api/relations', {
      params: { fromId, fromType },
    });
    return response.data;
  }

  async getRelationsTo(toId: string, toType: string): Promise<Relation[]> {
    const response = await apiClient.get<Relation[]>('/api/relations', {
      params: { toId, toType },
    });
    return response.data;
  }

  async checkRelation(fromId: string, fromType: string, relationType: string, toId: string, toType: string): Promise<boolean> {
    try {
      await apiClient.get('/api/relation', {
        params: { fromId, fromType, relationType, toId, toType },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const thingsBoardService = new ThingsBoardService();
