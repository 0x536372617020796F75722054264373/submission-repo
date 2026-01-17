import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hyperliquid_ledger?schema=public',
  },

  hyperliquid: {
    apiUrl: process.env.HL_API_URL || 'https://api.hyperliquid.xyz',
    wsUrl: process.env.HL_WS_URL || 'wss://api.hyperliquid.xyz/ws',
  },

  builderOnly: {
    targetBuilder: process.env.TARGET_BUILDER || null,
  },

  testWallets: process.env.TEST_WALLETS?.split(',').map(w => w.trim()) || [],
};
