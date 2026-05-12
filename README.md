# ThingsBoard Asset Relations Reporter

A Node.js + TypeScript reporting service that authenticates against ThingsBoard, loads the tenant asset tree, walks `Contains` relations recursively, and produces a JSON report shaped as:

`Customer Name -> Asset Name -> Related Device IDs`

This repository was built as an interview exercise. The code and this README both reflect the real issues encountered against the provided live instance, not only the ideal API flow from the prompt.

## What the app does

- Authenticates once and reuses the JWT for the full run.
- Loads tenant assets with pagination.
- Prefers `/api/tenant/assetInfos` for richer metadata.
- Falls back to `/api/tenant/assets` when the target instance does not support `assetInfos`.
- Rebuilds `customerTitle` values by loading only the unique customers referenced by assets.
- Walks `ASSET -> Contains -> ASSET` recursively until it reaches `DEVICE` leaves.
- Caches relation lookups and resolved subtrees so shared branches are not recomputed.
- Prints a detailed console trace during the run so the user can see what is happening and which phase is active.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
3. Fill in the credentials and base URL in `.env`.
4. Run the reporter:
   ```bash
   npm start
   ```
5. Build for production if needed:
   ```bash
   npm run build
   npm run serve
   ```

## Environment Variables

```env
THINGSBOARD_BASE_URL=https://webapp02.heatmanager.cloud
THINGSBOARD_USERNAME=user@example.com
THINGSBOARD_PASSWORD=PASSWORD
THINGSBOARD_PAGE_SIZE=100
THINGSBOARD_RELATION_CONCURRENCY=10
```

## Architecture

- `src/services/api-client.ts`
  Handles Axios setup, JWT acquisition, token reuse, and normalized error formatting.
- `src/services/thingsboard.service.ts`
  Encapsulates pagination, customer hydration, relation traversal, caching, and fallback behavior.
- `src/index.ts`
  Orchestrates the run, reports progress to the console, and outputs the final JSON report.
- `src/utils/async.ts`
  Provides reusable concurrency helpers used to keep the run fast without flooding the API.

## Problems Encountered and How I Fixed Them

- Invalid base URL in `.env`
  The initial login failed with `ERR_INVALID_URL` because the base URL variable contained the username instead of the ThingsBoard host. I added strict URL normalization and validation so misconfigured environments fail early with a clear message.
- Unsupported `/api/tenant/assetInfos` endpoint on the target instance
  The original design used `assetInfos` because it is the most efficient endpoint for this use case. During live testing, the provided instance returned `400 Invalid UUID string: assetInfos`, which means that route is not available on that deployment. I implemented a fallback to `/api/tenant/assets` and then hydrated customer names separately.
- Wrong first assumption about relation depth
  The first implementation assumed assets would directly contain devices. Live data showed a deeper hierarchy: many assets contain other assets first, and devices sit lower in the tree. I changed the traversal to recurse through child assets until device leaves are found.
- Performance risk from naive recursion
  A naive recursive walk would repeatedly query the same subtrees from multiple parents and would create too much API fan-out. I added memoized subtree resolution, cached relation lookups, paginated loading, unique-customer hydration, and bounded concurrency.
- Lack of run visibility
  Long-running CLI tasks feel broken if they are silent. I added phase-based console logging for authentication, asset loading, fallback behavior, customer hydration, traversal progress, cache reuse, and completion summary.

## Performance Strategy

- JWT is fetched once and cached for the run.
- Asset loading is paginated.
- Customer hydration only loads unique customer IDs.
- Relation requests are memoized per asset.
- Recursive subtree results are memoized per asset, which avoids recomputing shared branches.
- Traversal is concurrency-limited so the API is used aggressively but not blindly.
- The code prefers the richer endpoint first, but remains compatible with the target instance through fallback logic.

## Example Run Characteristics

- The tested tenant contained 3,000+ assets.
- The target instance required fallback from `assetInfos` to `assets`.
- The hierarchy was not flat; recursive descent was necessary to discover device descendants.
- The reporter prints progress throughout the run because the traversal phase can take noticeable time on a large tenant.

## Time Log

- Planning and endpoint review: 15m
- Initial implementation: 1h
- Live debugging against the provided instance: 25m
- Recursive traversal and performance hardening: 30m
- Documentation and cleanup: 20m
- Total: ~2.5 hours

## Why this is production-minded

- The app does not assume the remote ThingsBoard instance matches the documentation exactly.
- It fails clearly on configuration errors.
- It adapts when the preferred endpoint is unavailable.
- It keeps performance in mind for both data volume and API safety.
- It exposes enough runtime information that an operator can tell whether it is working, stalled, or finishing.
