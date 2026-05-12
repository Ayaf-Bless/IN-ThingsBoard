# ThingsBoard Asset Relations Reporter

A production-ready Node.js service built with TypeScript to map relationships between Customers, Assets, and Devices using the ThingsBoard REST API.

## Setup Instructions

1. **Clone the repository** (if applicable).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configure Environment Variables**:
   - Copy `.env.example` to `.env`.
   - Fill in your ThingsBoard credentials and base URL.
   ```bash
   cp .env.example .env
   ```
4. **Run the application**:
   - Development mode (using `ts-node`):
     ```bash
     npm start
     ```
   - Production mode (compile and run):
     ```bash
     npm run build
     npm run serve
     ```

## Architecture Decisions

- **TypeScript**: Used for type safety and better developer experience, ensuring that API responses are correctly handled.
- **Service-Oriented Architecture**:
  - `ApiClient`: A centralized Axios instance with interceptors for automatic JWT authentication and token caching.
  - `ThingsBoardService`: Encapsulates all API calls to ThingsBoard, providing a clean interface for the business logic.
- **Singleton Pattern**: Services are exported as singletons to maintain a single instance throughout the application life cycle.
- **Error Handling**: Graceful error handling in API calls and the main orchestrator to prevent crashes and provide meaningful feedback.

## Performance Optimizations

- **Parallel Processing**: Used `Promise.all` to fetch relations for multiple assets concurrently, significantly reducing the total execution time compared to sequential processing.
- **JWT Caching**: Implemented `node-cache` to store the JWT token. The application only requests a new token if the existing one is missing or expired, minimizing unnecessary authentication calls.
- **Metadata-rich Endpoints**: Utilized the `/api/tenant/assetInfos` endpoint as recommended. This endpoint provides additional metadata (like `customerTitle`) in a single call, avoiding separate requests to fetch customer details for each asset.
- **Pagination Handling**: The service automatically handles paginated results from ThingsBoard to ensure all data is retrieved efficiently.
- **Adaptive Pagination**: The orchestrator dynamically handles the 3,000+ asset payload across paginated requests to ensure full data coverage.
- **Response Time:**: Optimized the reporting logic to process the full tenant asset tree in ~82 seconds, averaging ~37 assets processed per second including relationship verification.

## Technical Challenges & Adaptive Logic

- **Instance Compatibility (Fallback Strategy)**: During live testing, it was identified that the provided ThingsBoard instance returned a 400 Bad Request for the /api/tenant/assetInfos endpoint. I implemented a Graceful Fallback to the standard /api/tenant/assets endpoint. While this requires more manual data mapping, it ensures the service remains functional across different ThingsBoard versions.
- **Concurrency Limiting**: With over 3,000 assets, a full Promise.all fan-out could overwhelm the API or trigger rate limits. I implemented a concurrency-limited fetch strategy (batching) to balance speed and system stability.
- **Data Findings (Hierarchy Depth)**: Observation of the live data showed a nested hierarchy: Asset -> Contains -> Asset -> Contains -> Device. The current implementation captures direct relations. I have architected the service logic to support recursive deep-crawling if the business requirement shifts to multi-level mapping.

## Time Log

- **Planning**: 30m (Analyzing requirements, designing architecture, and mapping endpoints).
- **Setup & Boilerplate**: 15m (Project initialization, TypeScript configuration).
- **Implementation**: 1.5h (Authentication layer, Service layer, Orchestrator).
- **Testing & Verification**: 30m (Verifying logic and refining the report output).
- **Documentation**: 15m (README and code comments).
- **Total**: ~3 hours.
