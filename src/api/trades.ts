import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { TradesQueryParams } from '../types';

export async function tradesRoutes(fastify: FastifyInstance, prisma: PrismaClient) {
  /**
   * GET /v1/trades
   * Returns normalized fills for a user
   */
  fastify.get<{
    Querystring: TradesQueryParams;
  }>('/trades', async (request: FastifyRequest<{ Querystring: TradesQueryParams }>, reply: FastifyReply) => {
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

      // If builderOnly mode, need to filter out fills from tainted lifecycles
      let fills = await prisma.fill.findMany({
        where,
        orderBy: { timeMs: 'asc' },
      });

      if (builderOnly) {
        // Get tainted lifecycles
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

        // Create a map of tainted time ranges per coin
        const taintedRanges: Record<string, Array<{ start: bigint; end: bigint | null }>> = {};

        for (const lifecycle of lifecycles) {
          const isTainted = lifecycle.hasBuilderFills && lifecycle.hasNonBuilderFills;
          if (isTainted) {
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

      // Format response
      const response = fills.map((fill) => ({
        timeMs: Number(fill.timeMs),
        coin: fill.coin,
        side: fill.side,
        px: fill.px.toString(),
        sz: fill.sz.toString(),
        fee: fill.fee.toString(),
        closedPnl: fill.closedPnl?.toString() || '0',
        builder: fill.builderFee && parseFloat(fill.builderFee.toString()) > 0 ? 'attributed' : undefined,
      }));

      return reply.send(response);
    } catch (error) {
      console.error('Error fetching trades:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
