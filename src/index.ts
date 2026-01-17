import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import path from 'path';
import { tradesRoutes } from './api/trades';
import { positionsRoutes } from './api/positions';
import { pnlRoutes } from './api/pnl';
import { leaderboardRoutes } from './api/leaderboard';
import { depositsRoutes } from './api/deposits';
import { HyperliquidDatasource } from './models/hyperliquid.datasource';
import { IngestionService } from './services/ingestion.service';

const prisma = new PrismaClient();
const fastify = Fastify({
  logger: true,
});

async function main() {
  try {
    // Register CORS
    await fastify.register(cors, {
      origin: true,
    });

    // Serve static files (UI)
    await fastify.register(fastifyStatic, {
      root: path.join(__dirname, '../public'),
      prefix: '/',
    });

    // Health check endpoint
    fastify.get('/health', async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: 'ok', database: 'connected' };
      } catch (error) {
        return { status: 'error', database: 'disconnected' };
      }
    });

    // Register API routes under /v1
    const datasource = new HyperliquidDatasource();
    fastify.register(async (instance) => {
      await tradesRoutes(instance, prisma);
      await positionsRoutes(instance, prisma);
      await pnlRoutes(instance, prisma);
      await leaderboardRoutes(instance, prisma);
      await depositsRoutes(instance, prisma, datasource);
    }, { prefix: '/v1' });

    // Ingestion endpoint (for manual triggers)
    fastify.post('/ingest', async (request, reply) => {
      const { user, coin } = request.body as { user?: string; coin?: string };

      if (!user) {
        return reply.code(400).send({ error: 'user parameter is required' });
      }

      try {
        const datasource = new HyperliquidDatasource();
        const ingestionService = new IngestionService(prisma, datasource);
        const count = await ingestionService.ingestUserFills(user, coin);

        return reply.send({
          message: `Ingested ${count} fills for user ${user}`,
          fillsIngested: count,
        });
      } catch (error) {
        console.error('Ingestion error:', error);
        return reply.code(500).send({ error: 'Failed to ingest data' });
      }
    });

    // Start server
    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log(`Server listening on ${address}`);
    console.log(`Health check: ${address}/health`);
    console.log(`API docs: ${address}/v1/trades, ${address}/v1/positions/history, ${address}/v1/pnl, ${address}/v1/leaderboard`);

    // Perform initial ingestion if test wallets are configured
    if (config.testWallets.length > 0) {
      console.log(`Starting initial ingestion for ${config.testWallets.length} test wallets...`);
      const datasource = new HyperliquidDatasource();
      const ingestionService = new IngestionService(prisma, datasource);

      // Run ingestion in background
      setTimeout(async () => {
        try {
          await ingestionService.ingestMultipleUsers(config.testWallets);
          console.log('Initial ingestion complete');
        } catch (error) {
          console.error('Initial ingestion failed:', error);
        }
      }, 1000);
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
});

main();
