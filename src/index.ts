import { config } from './config';
import { formatAxiosError } from './services/api-client';
import { thingsBoardService } from './services/thingsboard.service';
import { AssetInfo } from './types/thingsboard';
import { mapWithConcurrency } from './utils/async';

interface AssetReport {
  customerName: string;
  assetName: string;
  assetType: string;
  relatedDevices: string[];
}

function createLogger() {
  const startedAt = Date.now();

  const prefix = () => `[+${((Date.now() - startedAt) / 1000).toFixed(1)}s]`;

  return {
    info(message: string) {
      console.log(`${prefix()} ${message}`);
    },
    error(message: string) {
      console.error(`${prefix()} ${message}`);
    },
  };
}

async function generateReport() {
  const startTime = Date.now();
  const logger = createLogger();

  logger.info('Starting report generation.');
  logger.info('The reporter will authenticate, load tenant assets, walk the asset tree recursively, and then print the final JSON report.');

  try {
    logger.info(`Loading assets with page size ${config.pageSize}.`);
    const assets: AssetInfo[] = await thingsBoardService.getAllAssetInfos(config.pageSize, logger.info);
    logger.info(`Asset loading complete. Found ${assets.length} assets.`);

    thingsBoardService.resetTraversalState();
    logger.info(
      `Starting recursive containment traversal with bounded concurrency ${config.relationConcurrency}. Each resolved subtree will be cached for reuse.`
    );

    let processedAssets = 0;
    let totalResolvedDeviceLinks = 0;
    const assetReports: AssetReport[] = await mapWithConcurrency(assets, config.relationConcurrency, async (asset) => {
      const deviceIds = await thingsBoardService.getDescendantDeviceIds(asset.id.id);
      processedAssets++;
      totalResolvedDeviceLinks += deviceIds.length;

      if (processedAssets === 1 || processedAssets % 100 === 0 || processedAssets === assets.length) {
        const stats = thingsBoardService.getTraversalStats();
        logger.info(
          [
            `Traversal progress ${processedAssets}/${assets.length} assets.`,
            `Relation requests sent: ${stats.relationRequests}.`,
            `Relation cache hits: ${stats.relationCacheHits}.`,
            `Subtree cache hits: ${stats.subtreeCacheHits}.`,
            `Cached subtrees: ${stats.cachedSubtrees}.`,
            `Device links resolved so far: ${totalResolvedDeviceLinks}.`,
          ].join(' ')
        );
      }

      return {
        customerName: asset.customerTitle || 'Tenant Asset',
        assetName: asset.name,
        assetType: asset.type,
        relatedDevices: deviceIds,
      };
    });

    const assetsWithDevices = assetReports.filter((assetReport) => assetReport.relatedDevices.length > 0).length;
    const duration = (Date.now() - startTime) / 1000;
    logger.info(
      `Traversal complete. ${assetsWithDevices}/${assetReports.length} assets resolved to at least one device. Total runtime: ${duration.toFixed(2)}s.`
    );

    console.log('--- Report ---');
    console.log(JSON.stringify(assetReports, null, 2));
  } catch (error) {
    logger.error(`Report generation failed: ${formatAxiosError(error)}`);
    process.exitCode = 1;
  }
}

generateReport();
