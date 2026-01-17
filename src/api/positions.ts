import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PositionsQueryParams } from '../types';

export async function positionsRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  /**
   * GET /v1/positions/history
   * Returns time-ordered position states for a user
   */
  fastify.get<{
    Querystring: PositionsQueryParams;
  }>('/positions/history', async (
    request: FastifyRequest<{ Querystring: PositionsQueryParams }>,
    reply: FastifyReply
  ) => {
    const { user, coin, fromMs, toMs, builderOnly } = request.query;

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

      // Fetch positions
      let positions = await prisma.position.findMany({
        where,
        orderBy: { timeMs: 'asc' },
      });

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

        // Build tainted ranges per coin
        const taintedRanges: Record<string, Array<{ start: bigint; end: bigint | null; tainted: boolean }>> = {};

        for (const lifecycle of lifecycles) {
          if (!taintedRanges[lifecycle.coin]) {
            taintedRanges[lifecycle.coin] = [];
          }

          const isTainted = lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills;

          taintedRanges[lifecycle.coin].push({
            start: lifecycle.startMs,
            end: lifecycle.endMs,
            tainted: isTainted,
          });
        }

        // Filter and mark positions
        positions = positions.filter((position) => {
          const ranges = taintedRanges[position.coin] || [];

          // Check if position belongs to a builder-attributed lifecycle
          for (const range of ranges) {
            if (
              position.timeMs >= range.start &&
              (range.end === null || position.timeMs <= range.end)
            ) {
              // Exclude tainted positions in builder-only mode
              if (range.tainted) {
                return false;
              }
              // Include non-tainted positions
              return true;
            }
          }

          // Exclude positions not in any builder lifecycle
          return false;
        });
      }

      // Format response
      const response = positions.map((position) => {
        const result: any = {
          timeMs: Number(position.timeMs),
          netSize: position.netSize.toString(),
          avgEntryPx: position.avgEntryPx.toString(),
        };

        // Add optional risk fields if available
        if (position.liquidationPx) {
          result.liqPx = position.liquidationPx.toString();
        }
        if (position.marginUsed) {
          result.marginUsed = position.marginUsed.toString();
        }

        if (builderOnly) {
          result.tainted = false; // Already filtered out tainted ones
        }

        return result;
      });

      return reply.send(response);
    } catch (error) {
      console.error('Error fetching position history:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
