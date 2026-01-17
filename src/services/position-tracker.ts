import { PrismaClient } from '@prisma/client';
import { Fill } from '../types';
import * as decimal from '../utils/decimal';

export class PositionTracker {
  constructor(private prisma: PrismaClient) {}

  /**
   * Reconstruct position history from fills
   * Tracks position lifecycles and calculates average entry price
   */
  async reconstructPositionHistory(
    user: string,
    coin: string,
    fills: Fill[]
  ): Promise<void> {
    if (fills.length === 0) return;

    // Sort fills by time
    const sortedFills = [...fills].sort((a, b) => a.timeMs - b.timeMs);

    let netSize = '0';
    let avgEntryPx = '0';
    let currentLifecycleId: number | null = null;
    let hasBuilderFills = false;
    let hasNonBuilderFills = false;

    for (const fill of sortedFills) {
      const fillSize = fill.side === 'B' ? fill.sz : decimal.multiply(fill.sz, '-1');
      const oldSize = netSize;
      const newSize = decimal.add(netSize, fillSize);

      // Track builder vs non-builder fills for taint detection
      const isBuilderFill = !!(fill.builderFee && parseFloat(fill.builderFee) > 0);

      // Check if starting new lifecycle (0 → non-zero)
      if (decimal.isZero(oldSize) && !decimal.isZero(newSize)) {
        // Close any existing lifecycle (shouldn't happen but safeguard)
        if (currentLifecycleId !== null) {
          await this.prisma.positionLifecycle.update({
            where: { id: currentLifecycleId },
            data: {
              endMs: fill.timeMs,
              hasBuilderFills,
              hasNonBuilderFills,
            },
          });
        }

        // Start new lifecycle
        const lifecycle = await this.prisma.positionLifecycle.create({
          data: {
            user,
            coin,
            startMs: fill.timeMs,
            endMs: null,
            hasBuilderFills: isBuilderFill,
            hasNonBuilderFills: !isBuilderFill,
          },
        });

        currentLifecycleId = lifecycle.id;
        hasBuilderFills = isBuilderFill;
        hasNonBuilderFills = !isBuilderFill;
      } else if (currentLifecycleId !== null) {
        // Update existing lifecycle
        if (isBuilderFill) hasBuilderFills = true;
        if (!isBuilderFill) hasNonBuilderFills = true;
      }

      // Calculate new average entry price
      avgEntryPx = this.calculateAvgEntryPx(oldSize, avgEntryPx, fillSize, fill.px);
      netSize = newSize;

      // Store position snapshot
      await this.prisma.position.upsert({
        where: {
          user_coin_timeMs: {
            user,
            coin,
            timeMs: BigInt(fill.timeMs),
          },
        },
        create: {
          user,
          coin,
          timeMs: BigInt(fill.timeMs),
          netSize,
          avgEntryPx,
        },
        update: {
          netSize,
          avgEntryPx,
        },
      });

      // Check if closing lifecycle (non-zero → 0)
      if (!decimal.isZero(oldSize) && decimal.isZero(newSize) && currentLifecycleId !== null) {
        await this.prisma.positionLifecycle.update({
          where: { id: currentLifecycleId },
          data: {
            endMs: fill.timeMs,
            hasBuilderFills,
            hasNonBuilderFills,
          },
        });

        currentLifecycleId = null;
        hasBuilderFills = false;
        hasNonBuilderFills = false;
        avgEntryPx = '0';
      }
    }

    // If lifecycle is still open, update it
    if (currentLifecycleId !== null) {
      await this.prisma.positionLifecycle.update({
        where: { id: currentLifecycleId },
        data: {
          hasBuilderFills,
          hasNonBuilderFills,
        },
      });
    }
  }

  /**
   * Calculate average entry price using average cost method
   */
  private calculateAvgEntryPx(
    oldSize: string,
    oldAvgPx: string,
    fillSize: string,
    fillPx: string
  ): string {
    const oldSizeNum = parseFloat(oldSize);
    const fillSizeNum = parseFloat(fillSize);
    const newSizeNum = oldSizeNum + fillSizeNum;

    // If position is zero, no entry price
    if (newSizeNum === 0) {
      return '0';
    }

    // If old size is zero, entry price is the fill price
    if (oldSizeNum === 0) {
      return fillPx;
    }

    // If same side (adding to position)
    if ((oldSizeNum > 0 && fillSizeNum > 0) || (oldSizeNum < 0 && fillSizeNum < 0)) {
      const oldValue = Math.abs(oldSizeNum) * parseFloat(oldAvgPx);
      const fillValue = Math.abs(fillSizeNum) * parseFloat(fillPx);
      const newAvgPx = (oldValue + fillValue) / Math.abs(newSizeNum);
      return newAvgPx.toString();
    }

    // If reducing position (partial close), keep old average
    if (Math.abs(newSizeNum) < Math.abs(oldSizeNum)) {
      return oldAvgPx;
    }

    // If flipping position (long → short or vice versa)
    if ((oldSizeNum > 0 && newSizeNum < 0) || (oldSizeNum < 0 && newSizeNum > 0)) {
      return fillPx;
    }

    return oldAvgPx;
  }

  /**
   * Get position lifecycles for user/coin in time range
   */
  async getPositionLifecycles(
    user: string,
    coin?: string,
    fromMs?: number,
    toMs?: number
  ) {
    return this.prisma.positionLifecycle.findMany({
      where: {
        user,
        ...(coin && { coin }),
        ...(fromMs && {
          OR: [
            { startMs: { gte: BigInt(fromMs) } },
            { endMs: { gte: BigInt(fromMs) } },
            { endMs: null },
          ],
        }),
        ...(toMs && {
          startMs: { lte: BigInt(toMs) },
        }),
      },
      orderBy: { startMs: 'asc' },
    });
  }

  /**
   * Check if a position lifecycle is tainted (has both builder and non-builder fills)
   */
  isTainted(lifecycle: { hasBuilderFills: boolean; hasNonBuilderFills: boolean }): boolean {
    return lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills;
  }
}
