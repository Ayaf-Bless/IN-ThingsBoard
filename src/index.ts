import { thingsBoardService } from './services/thingsboard.service';
import { AssetInfo, Relation } from './types/thingsboard';
import { config } from './config';

interface AssetReport {
  customerName: string;
  assetName: string;
  assetType: string;
  relatedDevices: string[];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function generateReport() {
  console.log('Starting report generation...');
  const startTime = Date.now();

  try {
    // 1. Fetch all assets (using assetInfos for efficiency)
    console.log('Fetching assets...');
    const assets: AssetInfo[] = await thingsBoardService.getAllAssetInfos(config.pageSize);
    console.log(`Found ${assets.length} assets.`);

    // 2. Fetch relations for each asset with bounded concurrency to avoid API overload.
    console.log(`Fetching relations for assets with concurrency ${config.relationConcurrency}...`);
    const assetReports: AssetReport[] = await mapWithConcurrency(
      assets,
      config.relationConcurrency,
      async (asset) => {
        // In ThingsBoard, "Asset Contains Device" is typically: Asset (from) -> Contains -> Device (to)
        // So we query for relations starting FROM the asset.
        const relations: Relation[] = await thingsBoardService.getRelationsFrom(asset.id.id, asset.id.entityType);

        // Filter for devices that the asset "Contains"
        const deviceIds = relations
          .filter(rel => rel.to.entityType === 'DEVICE' && rel.type === 'Contains')
          .map(rel => rel.to.id);

        return {
          customerName: asset.customerTitle || 'Tenant Asset',
          assetName: asset.name,
          assetType: asset.type,
          relatedDevices: deviceIds,
        };
      }
    );

    // 3. Output the report
    console.log('--- Report ---');
    console.log(JSON.stringify(assetReports, null, 2));

    const duration = (Date.now() - startTime) / 1000;
    console.log(`Report generated in ${duration}s`);

  } catch (error) {
    console.error('Error generating report:', error);
  }
}

generateReport();
