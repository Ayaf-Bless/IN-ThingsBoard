import axios from 'axios';
import { apiClient } from './api-client';
import { formatAxiosError } from './api-client';
import { Asset, AssetInfo, Customer, PageData, Relation } from '../types/thingsboard';

const NULL_UUID = '13814000-1dd2-11b2-8080-808080808080';

export class ThingsBoardService {
  private async getAllPages<T>(path: string, pageSize = 100): Promise<T[]> {
    let records: T[] = [];
    let hasNext = true;
    let page = 0;

    while (hasNext) {
      const response = await apiClient.get<PageData<T>>(path, {
        params: { pageSize, page },
      });
      records = records.concat(response.data.data);
      hasNext = response.data.hasNext;
      page++;
    }

    return records;
  }

  async getAllAssetInfos(pageSize = 100): Promise<AssetInfo[]> {
    try {
      return await this.getAllPages<AssetInfo>('/api/tenant/assetInfos', pageSize);
    } catch (error) {
      if (!this.shouldFallbackToTenantAssets(error)) {
        throw error;
      }

      console.warn(
        `AssetInfo endpoint unavailable; falling back to /api/tenant/assets. Reason: ${formatAxiosError(error)}`
      );

      const assets = await this.getAllPages<Asset>('/api/tenant/assets', pageSize);
      return this.hydrateAssetsWithCustomerTitles(assets);
    }
  }

  private shouldFallbackToTenantAssets(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return status === 400 || status === 404;
  }

  private async hydrateAssetsWithCustomerTitles(assets: Asset[]): Promise<AssetInfo[]> {
    const customerTitleMap = await this.getCustomerTitleMap(assets);

    return assets.map((asset) => ({
      ...asset,
      customerTitle: customerTitleMap.get(asset.customerId?.id) || 'Tenant Asset',
    }));
  }

  private async getCustomerTitleMap(assets: Asset[]): Promise<Map<string, string>> {
    const customerIds = [
      ...new Set(
        assets
          .map((asset) => asset.customerId?.id)
          .filter((customerId): customerId is string => Boolean(customerId) && customerId !== NULL_UUID)
      ),
    ];

    const customers = await Promise.all(
      customerIds.map(async (customerId) => {
        try {
          const response = await apiClient.get<Customer>(`/api/customer/${customerId}`);
          const title = response.data.title || response.data.name || 'Unknown Customer';
          return [customerId, title] as const;
        } catch (error) {
          console.warn(`Failed to load customer ${customerId}: ${formatAxiosError(error)}`);
          return [customerId, 'Unknown Customer'] as const;
        }
      })
    );

    return new Map(customers);
  }

  /**
   * Fetches relations starting FROM the specified entity.
   * Typically used to find what an Asset "Contains".
   */
  async getRelationsFrom(fromId: string, fromType: string): Promise<Relation[]> {
    const response = await apiClient.get<Relation[]>('/api/relations', {
      params: { fromId, fromType },
    });
    return response.data;
  }

  /**
   * Fetches relations pointing TO the specified entity.
   */
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
    } catch (error) {
      return false;
    }
  }
}

export const thingsBoardService = new ThingsBoardService();
