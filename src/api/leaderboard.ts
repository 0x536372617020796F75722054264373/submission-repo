import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { LeaderboardQueryParams, LeaderboardEntry } from '../types';
import * as decimal from '../utils/decimal';

export async function leaderboardRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  /**
   * GET /v1/leaderboard
   * Returns ranked list of users by metric
   */
  fastify.get<{
    Querystring: LeaderboardQueryParams;
  }>('/leaderboard', async (
    request: FastifyRequest<{ Querystring: LeaderboardQueryParams }>,
    reply: FastifyReply
  ) => {
    const { coin, fromMs, toMs, metric, builderOnly, maxStartCapital } = request.query;

    if (!metric) {
      return reply.code(400).send({ error: 'metric parameter is required (volume|pnl|returnPct)' });
    }

    try {
      // Get all users who have fills in the time range
      const where: any = {
        ...(coin && { coin }),
        ...(fromMs && { timeMs: { gte: BigInt(fromMs) } }),
        ...(toMs && { timeMs: { lte: BigInt(toMs) } }),
      };

      const fills = await prisma.fill.findMany({
        where,
        select: {
          user: true,
          coin: true,
          px: true,
          sz: true,
          fee: true,
          closedPnl: true,
          builderFee: true,
          timeMs: true,
        },
      });

      // Group fills by user
      const userFills: Record<string, typeof fills> = {};
      for (const fill of fills) {
        if (!userFills[fill.user]) {
          userFills[fill.user] = [];
        }
        userFills[fill.user].push(fill);
      }

      const leaderboardData: Array<{
        user: string;
        metricValue: number;
        tradeCount: number;
        tainted: boolean;
      }> = [];

      // Calculate metric for each user
      for (const [user, userFillsList] of Object.entries(userFills)) {
        let filteredFills = userFillsList;
        let isTainted = false;

        if (builderOnly) {
          // Get lifecycles for this user
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

          // Check for taint
          for (const lifecycle of lifecycles) {
            if (lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills) {
              isTainted = true;
              break;
            }
          }

          // If builderOnly, exclude tainted users from leaderboard
          if (isTainted) {
            continue;
          }

          // Filter to builder fills only
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

          filteredFills = userFillsList.filter((fill) => {
            const hasBuilderFee = fill.builderFee && parseFloat(fill.builderFee.toString()) > 0;
            if (!hasBuilderFee) return false;

            const ranges = taintedRanges[fill.coin] || [];
            for (const range of ranges) {
              if (
                fill.timeMs >= range.start &&
                (range.end === null || fill.timeMs <= range.end)
              ) {
                return false;
              }
            }

            return true;
          });
        }

        if (filteredFills.length === 0) continue;

        let metricValue = 0;

        if (metric === 'volume') {
          // Total notional traded
          for (const fill of filteredFills) {
            const notional = parseFloat(decimal.multiply(fill.px.toString(), fill.sz.toString()));
            metricValue += notional;
          }
        } else if (metric === 'pnl') {
          // Absolute realized PnL
          let pnl = '0';
          for (const fill of filteredFills) {
            if (fill.closedPnl) {
              pnl = decimal.add(pnl, fill.closedPnl.toString());
            }
          }
          metricValue = parseFloat(pnl);
        } else if (metric === 'returnPct') {
          // Relative return with capped normalization
          let pnl = '0';
          for (const fill of filteredFills) {
            if (fill.closedPnl) {
              pnl = decimal.add(pnl, fill.closedPnl.toString());
            }
          }

          if (fromMs !== undefined) {
            const equitySnapshot = await prisma.equitySnapshot.findFirst({
              where: {
                user,
                timeMs: { lte: BigInt(fromMs) },
              },
              orderBy: { timeMs: 'desc' },
            });

            const equityAtFromMs = equitySnapshot ? parseFloat(equitySnapshot.accountValue.toString()) : 0;

            if (equityAtFromMs > 0) {
              const effectiveCapital = maxStartCapital
                ? Math.min(equityAtFromMs, maxStartCapital)
                : equityAtFromMs;

              const returnPct = parseFloat(
                decimal.multiply(decimal.divide(pnl, effectiveCapital.toString()), '100')
              );
              metricValue = returnPct;
            }
          } else {
            metricValue = 0;
          }
        }

        leaderboardData.push({
          user,
          metricValue,
          tradeCount: filteredFills.length,
          tainted: isTainted,
        });
      }

      // Sort by metric value descending
      leaderboardData.sort((a, b) => b.metricValue - a.metricValue);

      // Add ranks
      const response: LeaderboardEntry[] = leaderboardData.map((entry, index) => ({
        rank: index + 1,
        user: entry.user,
        metricValue: entry.metricValue.toString(),
        tradeCount: entry.tradeCount,
        tainted: entry.tainted,
      }));

      return reply.send(response);
    } catch (error) {
      console.error('Error generating leaderboard:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
