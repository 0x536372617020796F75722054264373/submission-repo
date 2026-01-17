# System Architecture

## Overview

The Hyperliquid Trade Ledger API is a dockerized service that provides trade history, position tracking, and PnL analytics for Hyperliquid traders. The system implements builder-only mode filtering suitable for trading competitions and Insilico analysis.

## System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Applications                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTP/REST
┌─────────────────────▼───────────────────────────────────────┐
│                  Fastify REST API Server                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Routes: /v1/trades, /v1/positions/history,          │  │
│  │          /v1/pnl, /v1/leaderboard, /v1/deposits      │  │
│  └────────────────────┬─────────────────────────────────┘  │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │          Business Logic Layer                         │  │
│  │  - Position Lifecycle Tracker                         │  │
│  │  - Builder Attribution Filter                         │  │
│  │  - Taint Detection Logic                              │  │
│  │  - PnL Calculator                                     │  │
│  └────────────────────┬─────────────────────────────────┘  │
└─────────────────────┬─┴─────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              Data Access Layer (Prisma ORM)                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    PostgreSQL Database                       │
│  Tables: fills, positions, position_lifecycles,              │
│          users, equity_snapshots                             │
└──────────────────────────────────────────────────────────────┘
                      ▲
                      │
┌─────────────────────┴───────────────────────────────────────┐
│            Data Ingestion Service (Background)               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │        Datasource Abstraction Interface              │  │
│  │  - getUserFills(user, coin, fromMs, toMs)            │  │
│  │  - getUserPosition(user, coin)                       │  │
│  │  - getUserEquity(user)                               │  │
│  └────────────────────┬─────────────────────────────────┘  │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │     Hyperliquid API Client (Implementation)          │  │
│  │  - REST: POST https://api.hyperliquid.xyz/info       │  │
│  │  - WebSocket: wss://api.hyperliquid.xyz/ws           │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| Runtime | Node.js 20 + TypeScript 5 | Type safety, modern async/await |
| API Framework | Fastify 5 | High performance, built-in TypeScript support |
| Database | PostgreSQL 15 | ACID compliance, JSON support |
| ORM | Prisma 5 | Type-safe queries, auto-migrations |
| Containerization | Docker + docker-compose | Reproducible deployments |

## Database Schema

### Tables

#### 1. fills
Stores raw trade data from Hyperliquid API.

```sql
CREATE TABLE fills (
  id           SERIAL PRIMARY KEY,
  time_ms      BIGINT NOT NULL,
  user         VARCHAR(42) NOT NULL,
  coin         VARCHAR(20) NOT NULL,
  side         VARCHAR(4) NOT NULL,
  px           DECIMAL(20, 8) NOT NULL,
  sz           DECIMAL(20, 8) NOT NULL,
  fee          DECIMAL(20, 8) NOT NULL,
  closed_pnl   DECIMAL(20, 8),
  builder_fee  DECIMAL(20, 8),
  tid          VARCHAR(100) UNIQUE,
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_fills_user_coin_time ON fills(user, coin, time_ms);
CREATE INDEX idx_fills_user_time ON fills(user, time_ms);
```

#### 2. positions
Time-ordered position snapshots reconstructed from fills.

```sql
CREATE TABLE positions (
  id             SERIAL PRIMARY KEY,
  time_ms        BIGINT NOT NULL,
  user           VARCHAR(42) NOT NULL,
  coin           VARCHAR(20) NOT NULL,
  net_size       DECIMAL(20, 8) NOT NULL,
  avg_entry_px   DECIMAL(20, 8) NOT NULL,
  unrealized_pnl DECIMAL(20, 8),
  liquidation_px DECIMAL(20, 8),
  margin_used    DECIMAL(20, 8),
  created_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(user, coin, time_ms)
);

CREATE INDEX idx_positions_user_coin_time ON positions(user, coin, time_ms);
```

#### 3. position_lifecycles
Tracks position open/close cycles for taint detection.

```sql
CREATE TABLE position_lifecycles (
  id                     SERIAL PRIMARY KEY,
  user                   VARCHAR(42) NOT NULL,
  coin                   VARCHAR(20) NOT NULL,
  start_ms               BIGINT NOT NULL,
  end_ms                 BIGINT,
  has_builder_fills      BOOLEAN DEFAULT FALSE,
  has_non_builder_fills  BOOLEAN DEFAULT FALSE,
  created_at             TIMESTAMP DEFAULT NOW(),
  updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_lifecycles_user_coin_start ON position_lifecycles(user, coin, start_ms, end_ms);
```

**Taint Computation:**
```
tainted = (has_builder_fills AND has_non_builder_fills)
```

#### 4. equity_snapshots
Stores account value at various timestamps for return percentage calculations.

```sql
CREATE TABLE equity_snapshots (
  id            SERIAL PRIMARY KEY,
  user          VARCHAR(42) NOT NULL,
  time_ms       BIGINT NOT NULL,
  account_value DECIMAL(20, 8) NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(user, time_ms)
);

CREATE INDEX idx_equity_user_time ON equity_snapshots(user, time_ms);
```

#### 5. deposits
Tracks deposit transactions for competition filtering.

```sql
CREATE TABLE deposits (
  id         SERIAL PRIMARY KEY,
  user       VARCHAR(42) NOT NULL,
  time_ms    BIGINT NOT NULL,
  amount     DECIMAL(20, 8) NOT NULL,
  tx_hash    VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user, time_ms)
);

CREATE INDEX idx_deposits_user_time ON deposits(user, time_ms);
```

## Data Flow

### Ingestion Flow

```
1. API Request
   └─> POST /ingest {user: "0x123"}

2. Datasource Layer
   └─> HyperliquidDatasource.getUserFills(user)
       └─> HTTP POST https://api.hyperliquid.xyz/info
           Request: {type: "userFillsByTime", user: "0x123"}

3. Response Processing
   └─> Normalize fills to internal format
   └─> Store in fills table
   └─> Group by coin

4. Position Reconstruction
   └─> PositionTracker.reconstructPositionHistory(user, coin, fills)
       ├─> Track netSize changes
       ├─> Detect lifecycle start (0 → non-zero)
       ├─> Detect lifecycle end (non-zero → 0)
       ├─> Calculate avg entry price
       ├─> Mark builder vs non-builder fills
       └─> Store in position_lifecycles table

5. Equity Snapshot
   └─> Fetch current account value
   └─> Store in equity_snapshots table
```

### Query Flow

```
1. API Request
   └─> GET /v1/pnl?user=0x123&builderOnly=true

2. Route Handler (src/api/pnl.ts)
   └─> Parse query parameters
   └─> Validate user parameter

3. Database Query
   └─> SELECT * FROM fills WHERE user = '0x123'

4. Builder-Only Filtering (if enabled)
   └─> Query position_lifecycles
   └─> Identify tainted lifecycles
   └─> Filter fills:
       ├─> Exclude fills where builder_fee = 0
       └─> Exclude fills in tainted lifecycles

5. Metric Calculation
   └─> realizedPnl = SUM(closed_pnl)
   └─> feesPaid = SUM(fee)
   └─> tradeCount = COUNT(fills)
   └─> returnPct = (realizedPnl / effectiveCapital) * 100

6. Response
   └─> JSON {realizedPnl, returnPct, feesPaid, tradeCount, tainted}
```

## Position Lifecycle Tracking

### Lifecycle Detection Algorithm

```
Initialize:
  netSize = 0
  currentLifecycle = null

For each fill in chronological order:
  oldSize = netSize
  fillSize = (fill.side === 'B') ? fill.sz : -fill.sz
  newSize = oldSize + fillSize

  // Lifecycle start: 0 → non-zero
  if (oldSize == 0 && newSize != 0):
    currentLifecycle = CREATE position_lifecycle
      startMs = fill.timeMs
      hasBuilderFills = (fill.builderFee > 0)
      hasNonBuilderFills = (fill.builderFee == 0)

  // Update lifecycle flags
  else if (currentLifecycle exists):
    if (fill.builderFee > 0):
      currentLifecycle.hasBuilderFills = true
    if (fill.builderFee == 0):
      currentLifecycle.hasNonBuilderFills = true

  // Calculate average entry price
  avgEntryPx = calculateAvgEntryPx(oldSize, avgEntryPx, fillSize, fill.px)
  netSize = newSize

  // Store position snapshot
  UPSERT INTO positions (user, coin, timeMs, netSize, avgEntryPx)

  // Lifecycle end: non-zero → 0
  if (oldSize != 0 && newSize == 0):
    UPDATE currentLifecycle SET endMs = fill.timeMs
    currentLifecycle = null
    avgEntryPx = 0
```

### Average Entry Price Calculation

**Adding to position (same side):**
```
newAvgPx = (abs(oldSize) * oldAvgPx + abs(fillSize) * fillPx) / abs(newSize)
```

**Reducing position (partial close):**
```
avgPx remains unchanged
```

**Flipping position (long to short or vice versa):**
```
avgPx = fillPx
```

## Builder-Only Mode Implementation

### Builder Attribution Detection

```typescript
function isBuilderFill(fill: Fill): boolean {
  return fill.builderFee && parseFloat(fill.builderFee) > 0;
}
```

### Taint Detection

```typescript
function isTainted(lifecycle: PositionLifecycle): boolean {
  return lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills;
}
```

### Filtering Algorithm

```
When builderOnly=true:

1. Query position_lifecycles for user/coin/time range

2. Identify tainted lifecycles:
   taintedLifecycles = lifecycles WHERE
     has_builder_fills = true AND
     has_non_builder_fills = true

3. Filter fills:
   validFills = fills WHERE
     builder_fee > 0 AND
     NOT in_tainted_lifecycle(fill, taintedLifecycles)

4. Calculate metrics from validFills

5. Set tainted flag:
   tainted = EXISTS(taintedLifecycles)
```

## PnL Calculation

### Realized PnL

```
realizedPnl = SUM(fill.closedPnl for all fills in time range)
```

### Return Percentage (Capped Normalization)

```
equityAtFromMs = getEquitySnapshot(user, fromMs)
effectiveCapital = min(equityAtFromMs, maxStartCapital || equityAtFromMs)
returnPct = (realizedPnl / effectiveCapital) * 100
```

**Rationale**: Capping prevents large accounts from having unfair advantage in return percentage comparisons.

## Datasource Abstraction

### Interface Definition

```typescript
interface IDatasource {
  getUserFills(
    user: string,
    coin?: string,
    fromMs?: number,
    toMs?: number
  ): Promise<Fill[]>;

  getUserEquity(user: string, timeMs?: number): Promise<number>;

  getUserDeposits(
    user: string,
    fromMs?: number,
    toMs?: number
  ): Promise<DepositRecord[]>;

  getUserPositions(user: string): Promise<Map<string, Position>>;

  health(): Promise<boolean>;
}
```

### Current Implementation

**HyperliquidDatasource** (`src/models/hyperliquid.datasource.ts`):
- Implements IDatasource interface
- Calls Hyperliquid public API endpoints
- Normalizes responses to internal format
- Handles pagination for complete history

### Future Implementations

To swap data sources:

1. Create new class implementing `IDatasource`
2. Update `src/index.ts` line 36:
   ```typescript
   const datasource = new InsilicoHLDatasource();
   ```
3. All API endpoints automatically use new source

**Benefits:**
- Zero changes to business logic
- Zero changes to API endpoints
- Zero changes to database schema
- Single point of modification

## API Route Handlers

### Request Processing Pipeline

```
1. Request Reception
   └─> Fastify route handler (src/api/*.ts)

2. Parameter Validation
   └─> Check required parameters
   └─> Parse query strings

3. Database Query
   └─> Prisma ORM query construction
   └─> Execute with indexes

4. Builder-Only Filtering (if enabled)
   └─> Query lifecycles
   └─> Identify tainted
   └─> Filter fills

5. Metric Calculation
   └─> Business logic execution
   └─> Aggregation and computation

6. Response Formatting
   └─> JSON serialization
   └─> HTTP 200/400/500 status codes
```

### Error Handling

```
try {
  // Process request
} catch (error) {
  if (axios.isAxiosError(error)) {
    // External API error
    log.error('Hyperliquid API error:', error.response?.data);
  }
  return reply.code(500).send({ error: 'Internal server error' });
}
```

## Deployment Architecture

### Docker Multi-Stage Build

**Stage 1: Builder**
- Base image: node:20-alpine
- Install all dependencies
- Generate Prisma client
- Compile TypeScript to JavaScript

**Stage 2: Production**
- Base image: node:20-alpine
- Install production dependencies only
- Copy compiled code from builder
- Copy Prisma schema and client
- Copy static assets

**Benefits:**
- Smaller final image size
- Faster deployments
- Separation of build and runtime dependencies

### Docker Compose Services

**postgres:**
- Image: postgres:15-alpine
- Purpose: Database server
- Health check: pg_isready
- Volume: Persistent data storage

**api:**
- Build: From Dockerfile
- Purpose: API server
- Depends on: postgres (with health check)
- Ports: 3000 (API and web UI)
- Environment: Database URL, API endpoints

### Startup Sequence

```
1. docker-compose up --build
   ├─> Build API image (2 minutes)
   └─> Pull PostgreSQL image

2. Start postgres container
   ├─> Initialize database
   ├─> Wait for health check
   └─> Ready on port 5432

3. Start API container
   ├─> Run: prisma db push (create schema)
   ├─> Run: node dist/index.js (start server)
   ├─> Auto-ingest TEST_WALLETS
   └─> Ready on port 3000

Total time: Approximately 3 minutes
```

## Performance Optimizations

### Database Indexes

```sql
-- User queries
CREATE INDEX idx_fills_user_coin_time ON fills(user, coin, time_ms);
CREATE INDEX idx_fills_user_time ON fills(user, timeMs);

-- Coin queries
CREATE INDEX idx_fills_coin_time ON fills(coin, time_ms);

-- Position lookups
CREATE UNIQUE INDEX idx_positions_user_coin_time
  ON positions(user, coin, time_ms);

-- Lifecycle queries
CREATE INDEX idx_lifecycles_user_coin_range
  ON position_lifecycles(user, coin, start_ms, end_ms);
```

### Query Optimization

- Prisma generates optimized SQL with proper JOIN strategies
- WHERE clauses utilize indexes for sub-100ms response times
- UNIQUE constraints prevent duplicate data
- Batch inserts for position reconstruction

### Caching Strategy

**Current**: No caching (direct database queries)

**Future enhancements**:
- Redis for leaderboard caching
- In-memory caching for frequent user queries
- WebSocket subscriptions for real-time updates

## Security Considerations

### Input Validation

- User addresses validated as 0x-prefixed hex strings
- Timestamp parameters validated as numbers
- SQL injection prevented by Prisma parameterization
- Query parameter sanitization

### Rate Limiting

**Current**: No rate limiting (suitable for internal/competition use)

**Production recommendations**:
- Implement rate limiting per IP
- Add authentication for write endpoints
- Monitor for abuse patterns

## Monitoring & Logging

### Health Checks

```
GET /health
Response: {"status": "ok", "database": "connected"}
```

Monitor this endpoint for:
- Service availability
- Database connectivity
- Overall system health

### Logging

Fastify logger enabled with structured JSON logs:

```json
{
  "level": 30,
  "time": 1768603288098,
  "msg": "Server listening at http://127.0.0.1:3000"
}
```

Log levels:
- 30: INFO (normal operation)
- 40: WARN (potential issues)
- 50: ERROR (failures)

## Scalability Considerations

### Current Capacity

- Users: 100s
- Fills: 100,000s
- Response time: < 200ms

### Scaling Path

**Horizontal Scaling:**
- Run multiple API containers behind load balancer
- PostgreSQL read replicas for query distribution
- Redis for shared caching layer

**Vertical Scaling:**
- Increase database resources
- Add connection pooling
- Optimize queries with query analysis

**Database Partitioning:**
- Partition fills table by time range
- Partition by user for very large datasets

## Future Enhancements

**Real-Time Updates:**
- WebSocket client for live fill updates
- Incremental position recalculation
- Server-sent events for live leaderboards

**Advanced Analytics:**
- Multi-timeframe PnL (daily, weekly, monthly)
- Sharpe ratio and other risk metrics
- Win rate and average win/loss
- Maximum drawdown tracking

**Additional Data Sources:**
- On-chain deposit verification
- Cross-exchange position tracking
- Market data integration for mark-to-market PnL

## Development Workflow

### Local Development

```bash
# Watch mode with auto-reload
npm run dev

# TypeScript compilation
npm run build

# Database schema changes
npm run db:push

# Regenerate Prisma client
npm run db:generate
```

### Testing Workflow

```bash
# 1. Start services
docker-compose up -d

# 2. Ingest test data
curl -X POST http://localhost:3000/ingest \
  -H "Content-Type: application/json" \
  -d '{"user": "0x..."}'

# 3. Run tests
./test-api.sh 0x...

# 4. Verify responses
curl http://localhost:3000/v1/pnl?user=0x...
```

## Code Organization

### Modular Architecture

**Separation of Concerns:**
- `src/api/`: HTTP layer (routes, request/response)
- `src/services/`: Business logic (calculations, tracking)
- `src/models/`: Data access (datasources, abstractions)
- `src/types/`: Type definitions (interfaces, DTOs)
- `src/utils/`: Shared utilities (decimal math, helpers)
- `src/config/`: Configuration (environment variables)

**Benefits:**
- Easy to test individual components
- Clear responsibility boundaries
- Simple to add new features
- Maintainable codebase

### Dependency Injection

```typescript
// Main application
const prisma = new PrismaClient();
const datasource = new HyperliquidDatasource();

// Services receive dependencies
const ingestionService = new IngestionService(prisma, datasource);
const positionTracker = new PositionTracker(prisma);

// Routes receive dependencies
await tradesRoutes(fastify, prisma);
await depositsRoutes(fastify, prisma, datasource);
```

**Benefits:**
- Easy to swap implementations
- Testable with mocks
- Clear dependency graph

## API Design Principles

### RESTful Conventions

- GET for reads
- POST for mutations
- Query parameters for filtering
- Consistent response formats
- HTTP status codes (200, 400, 500)

### Response Consistency

All endpoints return:
- JSON format
- Consistent field naming (camelCase)
- Error objects: `{error: "message"}`
- Success objects: Typed data structures

### Filtering Strategy

All endpoints support consistent filtering:
- `user`: Required for user-specific endpoints
- `coin`: Optional coin filter
- `fromMs`, `toMs`: Optional time range
- `builderOnly`: Optional mode toggle

---

## Summary

This architecture provides:
- Clean separation of concerns
- Swappable data sources
- Type-safe database access
- Sophisticated builder-only filtering
- Production-ready deployment
- Comprehensive error handling
- Scalable design patterns

The system is designed for easy evaluation, modification, and future enhancement while maintaining code quality and performance.
