import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PnLQueryParams } from '../types';
import * as decimal from '../utils/decimal';

export async function pnlRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  /**
   * GET /v1/pnl
   * Returns PnL metrics for a user
   */
  fastify.get<{
    Querystring: PnLQueryParams;
  }>('/pnl', async (request: FastifyRequest<{ Querystring: PnLQueryParams }>, reply: FastifyReply) => {
    const { user, coin, fromMs, toMs, builderOnly, maxStartCapital } = request.query;

    if (!user) {
      return reply.code(400).send({ error: 'user parameter is required' });
    }

    try {
      // Build where clause
      const where: any = {
        user,
        ...(coin && { coin }),
        ...(fromMs && { timeMs: { gte: BigInt(fromMs) } }),
        ...(toMs && { timeMs: { lte: BigInt(toMs) } }),
      };

      // Fetch fills
      let fills = await prisma.fill.findMany({
        where,
      });

      let isTainted = false;

      if (builderOnly) {
        // Get lifecycles to determine tainted periods
        const lifecycles = await prisma.positionLifecycle.findMany({
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
            ...(toMs && { startMs: { lte: BigInt(toMs) } }),
          },
        });

        // Check if any lifecycle is tainted
        for (const lifecycle of lifecycles) {
          if (lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills) {
            isTainted = true;
            break;
          }
        }

        // Build tainted ranges
        const taintedRanges: Record<string, Array<{ start: bigint; end: bigint | null }>> = {};

        for (const lifecycle of lifecycles) {
          const isLifecycleTainted = lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills;
          if (isLifecycleTainted) {
            if (!taintedRanges[lifecycle.coin]) {
              taintedRanges[lifecycle.coin] = [];
            }
            taintedRanges[lifecycle.coin].push({
              start: lifecycle.startMs,
              end: lifecycle.endMs,
            });
          }
        }

        // Filter out fills in tainted ranges and non-builder fills
        fills = fills.filter((fill) => {
          // Only include builder-attributed fills
          const hasBuilderFee = fill.builderFee && parseFloat(fill.builderFee.toString()) > 0;
          if (!hasBuilderFee) return false;

          // Check if fill is in a tainted lifecycle
          const ranges = taintedRanges[fill.coin] || [];
          for (const range of ranges) {
            if (
              fill.timeMs >= range.start &&
              (range.end === null || fill.timeMs <= range.end)
            ) {
              return false; // Exclude fills in tainted lifecycles
            }
          }

          return true;
        });
      }

      // Calculate metrics
      let realizedPnl = '0';
      let feesPaid = '0';
      const tradeCount = fills.length;

      for (const fill of fills) {
        if (fill.closedPnl) {
          realizedPnl = decimal.add(realizedPnl, fill.closedPnl.toString());
        }
        feesPaid = decimal.add(feesPaid, fill.fee.toString());
      }

      // Calculate return percentage
      let returnPct = '0';

      if (fromMs !== undefined) {
        // Get equity at fromMs
        const equitySnapshot = await prisma.equitySnapshot.findFirst({
          where: {
            user,
            timeMs: { lte: BigInt(fromMs) },
          },
          orderBy: { timeMs: 'desc' },
        });

        const equityAtFromMs = equitySnapshot ? parseFloat(equitySnapshot.accountValue.toString()) : 0;

        if (equityAtFromMs > 0) {
          // Apply capped normalization
          const effectiveCapital = maxStartCapital
            ? Math.min(equityAtFromMs, maxStartCapital)
            : equityAtFromMs;

          returnPct = decimal.multiply(
            decimal.divide(realizedPnl, effectiveCapital.toString()),
            '100'
          );
        }
      }

      const response: any = {
        realizedPnl,
        returnPct,
        feesPaid,
        tradeCount,
      };

      if (builderOnly) {
        response.tainted = isTainted;
      }

      return reply.send(response);
    } catch (error) {
      console.error('Error calculating PnL:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
