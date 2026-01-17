import axios, { AxiosInstance } from 'axios';
import { IDatasource } from './datasource.interface';
import {
  Fill,
  HLFill,
  HLClearinghouseStateRequest,
  HLClearinghouseState,
  HLUserNonFundingLedgerUpdatesRequest,
  HLLedgerUpdate,
  DepositRecord,
} from '../types';
import { config } from '../config';

export class HyperliquidDatasource implements IDatasource {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.hyperliquid.apiUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Get user fills from Hyperliquid API with pagination for complete history
   */
  async getUserFills(
    user: string,
    coin?: string,
    fromMs?: number,
    toMs?: number
  ): Promise<Fill[]> {
    try {
      const allFills: Fill[] = [];
      let endTime = toMs || Date.now();
      let batchCount = 0;
      const maxBatches = 50; // Safety limit to prevent infinite loops

      console.log(`Fetching complete history for ${user}...`);

      // Track unique transaction IDs to detect when we have all data
      const seenTids = new Set<string>();
      let consecutiveDuplicateBatches = 0;

      // Paginate through all historical data
      while (batchCount < maxBatches) {
        batchCount++;

        let request: any;

        // First batch: use userFills if no time constraints
        if (batchCount === 1 && fromMs === undefined && toMs === undefined) {
          request = {
            type: 'userFills',
            user,
          };
        } else {
          // Subsequent batches or time-constrained: use userFillsByTime
          request = {
            type: 'userFillsByTime',
            user,
            startTime: fromMs || 0,
            endTime,
          };
        }

        const response = await this.client.post<HLFill[]>('/info', request);
        const fills = response.data;

        if (fills.length === 0) {
          console.log(`  Batch ${batchCount}: No more fills found`);
          break;
        }

        // Check for new unique fills
        const newUniqueFills = fills.filter(f => {
          const tid = f.tid.toString();
          if (seenTids.has(tid)) return false;
          seenTids.add(tid);
          return true;
        });

        console.log(`  Batch ${batchCount}: Fetched ${fills.length} fills, ${newUniqueFills.length} new unique (${new Date(fills[fills.length - 1].time).toISOString()} to ${new Date(fills[0].time).toISOString()})`);

        // Add only new unique fills
        const normalized = newUniqueFills.map((fill) => this.normalizeFill(fill, user));
        allFills.push(...normalized);

        // If we got 0 new unique fills, increment duplicate counter
        if (newUniqueFills.length === 0) {
          consecutiveDuplicateBatches++;
          if (consecutiveDuplicateBatches >= 3) {
            console.log(`  Stopping: 3 consecutive batches with no new data`);
            break;
          }
        } else {
          consecutiveDuplicateBatches = 0; // Reset counter if we found new data
        }

        // If batch size < 2000, we might be at the end, but continue a bit more to be sure
        if (fills.length < 2000 && newUniqueFills.length === 0) {
          console.log(`  Reached end of history (batch < 2000 and no new unique)`);
          break;
        }

        // Check if we've reached the fromMs boundary
        const oldestFillTime = fills[fills.length - 1].time;
        if (fromMs && oldestFillTime <= fromMs) {
          console.log(`  Reached fromMs boundary`);
          break;
        }

        // Set endTime for next batch
        endTime = oldestFillTime - 1;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`  Total fills fetched: ${allFills.length} (${batchCount} batches)`);

      // Filter by coin if specified
      let filteredFills = allFills;
      if (coin) {
        filteredFills = allFills.filter((f) => f.coin === coin);
      }

      // Sort by time ascending
      filteredFills.sort((a, b) => a.timeMs - b.timeMs);

      return filteredFills;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Hyperliquid API error:', error.response?.data || error.message);
      }
      throw new Error(`Failed to fetch user fills: ${error}`);
    }
  }

  /**
   * Get user equity/account value
   */
  async getUserEquity(user: string, _timeMs?: number): Promise<number> {
    try {
      const request: HLClearinghouseStateRequest = {
        type: 'clearinghouseState',
        user,
      };

      const response = await this.client.post<{ assetPositions: any[] } & HLClearinghouseState>(
        '/info',
        request
      );

      const state = response.data;
      const accountValue = parseFloat(state.marginSummary?.accountValue || state.crossMarginSummary?.accountValue || '0');

      return accountValue;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Hyperliquid API error:', error.response?.data || error.message);
      }
      throw new Error(`Failed to fetch user equity: ${error}`);
    }
  }

  /**
   * Health check
   */
  async health(): Promise<boolean> {
    try {
      // Try to fetch meta info as health check
      await this.client.post('/info', { type: 'meta' });
      return true;
    } catch (error) {
      console.error('Hyperliquid datasource health check failed:', error);
      return false;
    }
  }

  /**
   * Get current user positions with risk fields
   */
  async getUserPositions(user: string): Promise<Map<string, {
    netSize: string;
    entryPx: string;
    unrealizedPnl: string;
    liquidationPx: string | null;
    marginUsed: string;
  }>> {
    try {
      const request: HLClearinghouseStateRequest = {
        type: 'clearinghouseState',
        user,
      };

      const response = await this.client.post<HLClearinghouseState>('/info', request);
      const state = response.data;

      const positions = new Map<string, {
        netSize: string;
        entryPx: string;
        unrealizedPnl: string;
        liquidationPx: string | null;
        marginUsed: string;
      }>();

      for (const assetPos of state.assetPositions) {
        const pos = assetPos.position;
        positions.set(pos.coin, {
          netSize: pos.szi,
          entryPx: pos.entryPx,
          unrealizedPnl: pos.unrealizedPnl,
          liquidationPx: pos.liquidationPx,
          marginUsed: '0', // Position-specific marginUsed not directly available, use total
        });
      }

      return positions;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Hyperliquid API error:', error.response?.data || error.message);
      }
      throw new Error(`Failed to fetch user positions: ${error}`);
    }
  }

  /**
   * Get user deposit history
   */
  async getUserDeposits(user: string, fromMs?: number, toMs?: number): Promise<DepositRecord[]> {
    try {
      const request: HLUserNonFundingLedgerUpdatesRequest = {
        type: 'userNonFundingLedgerUpdates',
        user,
        startTime: fromMs,
        endTime: toMs,
      };

      const response = await this.client.post<HLLedgerUpdate[]>('/info', request);
      const updates = response.data;

      const deposits: DepositRecord[] = [];

      for (const update of updates) {
        // Filter for deposits only
        if (update.delta.type === 'deposit' && update.delta.usdc) {
          deposits.push({
            timeMs: update.time,
            amount: update.delta.usdc,
            txHash: update.hash,
          });
        }
      }

      return deposits;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Hyperliquid API error:', error.response?.data || error.message);
      }
      throw new Error(`Failed to fetch user deposits: ${error}`);
    }
  }

  /**
   * Normalize Hyperliquid fill to internal format
   */
  private normalizeFill(hlFill: HLFill, user: string): Fill {
    return {
      timeMs: hlFill.time,
      coin: hlFill.coin,
      side: hlFill.side === 'A' || hlFill.dir === 'Close Long' || hlFill.dir === 'Open Short' ? 'A' : 'B',
      px: hlFill.px,
      sz: hlFill.sz,
      fee: hlFill.fee,
      closedPnl: hlFill.closedPnl,
      builderFee: hlFill.builderFee,
      tid: hlFill.tid?.toString(),
      user,
      builder: hlFill.builderFee && parseFloat(hlFill.builderFee) > 0 ? 'builder' : undefined,
    };
  }
}
