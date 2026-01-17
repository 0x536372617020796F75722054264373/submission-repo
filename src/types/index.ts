export interface Fill {
  timeMs: number;
  coin: string;
  side: 'B' | 'A'; // B = buy, A = ask/sell
  px: string;
  sz: string;
  fee: string;
  closedPnl?: string;
  builderFee?: string;
  tid?: string;
  user?: string;
  builder?: string; // Derived from builderFee presence
}

export interface Position {
  timeMs: number;
  coin: string;
  netSize: string;
  avgEntryPx: string;
  unrealizedPnl?: string;
  liquidationPx?: string; // Optional risk field
  marginUsed?: string; // Optional risk field
  tainted?: boolean; // Only when builderOnly=true
}

export interface PositionLifecycle {
  id: number;
  user: string;
  coin: string;
  startMs: number;
  endMs: number | null;
  hasBuilderFills: boolean;
  hasNonBuilderFills: boolean;
  tainted: boolean;
}

export interface PnLResponse {
  realizedPnl: string;
  returnPct: string;
  feesPaid: string;
  tradeCount: number;
  tainted?: boolean; // Only when builderOnly=true
}

export interface LeaderboardEntry {
  rank: number;
  user: string;
  metricValue: string;
  tradeCount: number;
  tainted: boolean;
}

export interface DepositRecord {
  timeMs: number;
  amount: string;
  txHash?: string;
}

export interface DepositsResponse {
  totalDeposits: string;
  depositCount: number;
  deposits: DepositRecord[];
}

// Hyperliquid API types
export interface HLFill {
  coin: string;
  px: string;
  sz: string;
  side: string;
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  hash: string;
  oid: number;
  crossed: boolean;
  fee: string;
  tid: number;
  builderFee?: string;
}

export interface HLUserFillsRequest {
  type: 'userFills' | 'userFillsByTime';
  user: string;
  startTime?: number;
  endTime?: number;
  aggregateByTime?: boolean;
}

export interface HLClearinghouseStateRequest {
  type: 'clearinghouseState';
  user: string;
}

export interface HLAssetPosition {
  position: {
    coin: string;
    szi: string;
    leverage: {
      type: string;
      value: number;
    };
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    returnOnEquity: string;
    liquidationPx: string | null;
  };
}

export interface HLClearinghouseState {
  assetPositions: HLAssetPosition[];
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  withdrawable: string;
  time: number;
}

export interface HLUserNonFundingLedgerUpdatesRequest {
  type: 'userNonFundingLedgerUpdates';
  user: string;
  startTime?: number;
  endTime?: number;
}

export interface HLLedgerUpdate {
  time: number;
  hash: string;
  delta: {
    type: string; // "deposit", "withdraw", "internalTransfer", "liquidation", etc.
    usdc?: string;
    token?: string;
  };
}

// Query parameters for API endpoints
export interface TradesQueryParams {
  user: string;
  coin?: string;
  fromMs?: number;
  toMs?: number;
  builderOnly?: boolean;
}

export interface PositionsQueryParams {
  user: string;
  coin?: string;
  fromMs?: number;
  toMs?: number;
  builderOnly?: boolean;
}

export interface PnLQueryParams {
  user: string;
  coin?: string;
  fromMs?: number;
  toMs?: number;
  builderOnly?: boolean;
  maxStartCapital?: number;
}

export interface LeaderboardQueryParams {
  coin?: string;
  fromMs?: number;
  toMs?: number;
  metric: 'volume' | 'pnl' | 'returnPct';
  builderOnly?: boolean;
  maxStartCapital?: number;
}

export interface DepositsQueryParams {
  user: string;
  fromMs?: number;
  toMs?: number;
}
