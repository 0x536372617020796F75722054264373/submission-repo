import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { DepositsQueryParams, DepositsResponse } from '../types';
import { IDatasource } from '../models/datasource.interface';
import * as decimal from '../utils/decimal';

export async function depositsRoutes(
  fastify: FastifyInstance,
  prisma: PrismaClient,
  datasource: IDatasource
) {
  /**
   * GET /v1/deposits
   * Returns deposit history for a user
   */
  fastify.get<{
    Querystring: DepositsQueryParams;
  }>('/deposits', async (
    request: FastifyRequest<{ Querystring: DepositsQueryParams }>,
    reply: FastifyReply
  ) => {
    const { user, fromMs, toMs } = request.query;

    if (!user) {
      return reply.code(400).send({ error: 'user parameter is required' });
    }

    try {
      // Try to fetch from datasource (Hyperliquid API)
      let deposits = await datasource.getUserDeposits(user, fromMs, toMs);

      // If no deposits from API, try database
      if (deposits.length === 0) {
        const dbDeposits = await prisma.deposit.findMany({
          where: {
            user,
            ...(fromMs && { timeMs: { gte: BigInt(fromMs) } }),
            ...(toMs && { timeMs: { lte: BigInt(toMs) } }),
          },
          orderBy: { timeMs: 'desc' },
        });

        deposits = dbDeposits.map(d => ({
          timeMs: Number(d.timeMs),
          amount: d.amount.toString(),
          txHash: d.txHash || undefined,
        }));
      } else {
        // Store deposits in database for future reference
        for (const deposit of deposits) {
          await prisma.deposit.upsert({
            where: {
              user_timeMs: {
                user,
                timeMs: BigInt(deposit.timeMs),
              },
            },
            create: {
              user,
              timeMs: BigInt(deposit.timeMs),
              amount: deposit.amount,
              txHash: deposit.txHash,
            },
            update: {
              amount: deposit.amount,
              txHash: deposit.txHash,
            },
          });
        }
      }

      // Calculate totals
      let totalDeposits = '0';
      for (const deposit of deposits) {
        totalDeposits = decimal.add(totalDeposits, deposit.amount);
      }

      const response: DepositsResponse = {
        totalDeposits,
        depositCount: deposits.length,
        deposits,
      };

      return reply.send(response);
    } catch (error) {
      console.error('Error fetching deposits:', error);
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
