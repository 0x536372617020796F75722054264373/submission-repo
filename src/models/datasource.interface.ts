import { Fill, DepositRecord } from '../types';

/**
 * Datasource abstraction interface
 * Allows swapping between Hyperliquid public API, Insilico-HL, or HyperServe
 */
export interface IDatasource {
  /**
   * Get user fills in time range
   * @param user - User wallet address (0x...)
   * @param coin - Optional coin filter
   * @param fromMs - Optional start time in milliseconds
   * @param toMs - Optional end time in milliseconds
   * @returns Array of fills
   */
  getUserFills(
    user: string,
    coin?: string,
    fromMs?: number,
    toMs?: number
  ): Promise<Fill[]>;

  /**
   * Get user equity/account value at specific time
   * @param user - User wallet address
   * @param timeMs - Optional timestamp (defaults to current time)
   * @returns Account value in USD
   */
  getUserEquity(user: string, timeMs?: number): Promise<number>;

  /**
   * Get current user positions with risk fields
   * @param user - User wallet address
   * @returns Map of coin to position data with risk fields
   */
  getUserPositions(user: string): Promise<Map<string, {
    netSize: string;
    entryPx: string;
    unrealizedPnl: string;
    liquidationPx: string | null;
    marginUsed: string;
  }>>;

  /**
   * Get user deposit history
   * @param user - User wallet address
   * @param fromMs - Optional start time in milliseconds
   * @param toMs - Optional end time in milliseconds
   * @returns Array of deposits
   */
  getUserDeposits(user: string, fromMs?: number, toMs?: number): Promise<DepositRecord[]>;

  /**
   * Check if datasource is healthy/connected
   */
  health(): Promise<boolean>;
}
