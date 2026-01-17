import { PrismaClient } from '@prisma/client';
import { IDatasource } from '../models/datasource.interface';
import { PositionTracker } from './position-tracker';
import { Fill } from '../types';

export class IngestionService {
  private positionTracker: PositionTracker;

  constructor(
    private prisma: PrismaClient,
    private datasource: IDatasource
  ) {
    this.positionTracker = new PositionTracker(prisma);
  }

  /**
   * Ingest user fills for a specific user and coin
   */
  async ingestUserFills(
    user: string,
    coin?: string,
    fromMs?: number,
    toMs?: number
  ): Promise<number> {
    console.log(`Ingesting fills for user ${user}, coin: ${coin || 'all'}`);

    try {
      // Fetch fills from datasource
      const fills = await this.datasource.getUserFills(user, coin, fromMs, toMs);

      if (fills.length === 0) {
        console.log(`No fills found for user ${user}`);
        return 0;
      }

      console.log(`Fetched ${fills.length} fills for user ${user}`);

      // Store fills in database
      for (const fill of fills) {
        await this.prisma.fill.upsert({
          where: {
            tid: fill.tid || `${user}-${fill.timeMs}-${fill.coin}-${fill.sz}`,
          },
          create: {
            timeMs: BigInt(fill.timeMs),
            user: fill.user || user,
            coin: fill.coin,
            side: fill.side,
            px: fill.px,
            sz: fill.sz,
            fee: fill.fee,
            closedPnl: fill.closedPnl || null,
            builderFee: fill.builderFee || null,
            tid: fill.tid || `${user}-${fill.timeMs}-${fill.coin}-${fill.sz}`,
          },
          update: {
            closedPnl: fill.closedPnl || null,
            builderFee: fill.builderFee || null,
          },
        });
      }

      // Group fills by coin
      const fillsByCoin = fills.reduce((acc, fill) => {
        if (!acc[fill.coin]) acc[fill.coin] = [];
        acc[fill.coin].push(fill);
        return acc;
      }, {} as Record<string, Fill[]>);

      // Reconstruct position history for each coin
      for (const [coinSymbol, coinFills] of Object.entries(fillsByCoin)) {
        await this.positionTracker.reconstructPositionHistory(user, coinSymbol, coinFills);
      }

      // Store equity snapshot
      try {
        const equity = await this.datasource.getUserEquity(user);
        const now = Date.now();

        await this.prisma.equitySnapshot.upsert({
          where: {
            user_timeMs: {
              user,
              timeMs: BigInt(now),
            },
          },
          create: {
            user,
            timeMs: BigInt(now),
            accountValue: equity.toString(),
          },
          update: {
            accountValue: equity.toString(),
          },
        });
      } catch (error) {
        console.warn(`Failed to fetch equity for user ${user}:`, error);
      }

      return fills.length;
    } catch (error) {
      console.error(`Failed to ingest fills for user ${user}:`, error);
      throw error;
    }
  }

  /**
   * Ingest fills for multiple users
   */
  async ingestMultipleUsers(users: string[]): Promise<void> {
    console.log(`Ingesting fills for ${users.length} users...`);

    for (const user of users) {
      try {
        await this.ingestUserFills(user);
      } catch (error) {
        console.error(`Failed to ingest user ${user}:`, error);
        // Continue with next user
      }
    }

    console.log('Ingestion complete');
  }
}
