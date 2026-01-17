#!/bin/bash

# Hyperliquid Trade Ledger API - Test Script
# This script tests all API endpoints

API_URL="http://localhost:3000"

# Example wallet address (replace with actual address for testing)
USER_ADDRESS="${1:-0x0D1d9635D0640821d15e1435C38fD05418B09fCD}"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Hyperliquid Trade Ledger API Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 1. Health Check
echo -e "${YELLOW}1. Testing Health Check...${NC}"
curl -s "$API_URL/health" | jq '.'
echo ""

# 2. Ingest Data
echo -e "${YELLOW}2. Ingesting data for user: $USER_ADDRESS${NC}"
curl -s -X POST "$API_URL/ingest" \
  -H "Content-Type: application/json" \
  -d "{\"user\": \"$USER_ADDRESS\"}" | jq '.'
echo ""

# Wait a bit for ingestion
echo "Waiting 5 seconds for ingestion to complete..."
sleep 5
echo ""

# 3. Get Trades
echo -e "${YELLOW}3. Getting user trades...${NC}"
curl -s "$API_URL/v1/trades?user=$USER_ADDRESS" | jq '. | length as $count | {count: $count, sample: .[0:3]}'
echo ""

# 4. Get Position History
echo -e "${YELLOW}4. Getting position history...${NC}"
curl -s "$API_URL/v1/positions/history?user=$USER_ADDRESS" | jq '. | length as $count | {count: $count, sample: .[0:3]}'
echo ""

# 5. Get PnL
echo -e "${YELLOW}5. Getting PnL metrics...${NC}"
curl -s "$API_URL/v1/pnl?user=$USER_ADDRESS" | jq '.'
echo ""

# 6. Get Leaderboard
echo -e "${YELLOW}6. Getting leaderboard (by volume)...${NC}"
curl -s "$API_URL/v1/leaderboard?metric=volume" | jq '.'
echo ""

echo -e "${YELLOW}7. Getting leaderboard (by PnL)...${NC}"
curl -s "$API_URL/v1/leaderboard?metric=pnl" | jq '.'
echo ""

# 7. Test Builder-Only Mode
echo -e "${YELLOW}8. Testing builder-only mode...${NC}"
echo "Trades (builder-only):"
curl -s "$API_URL/v1/trades?user=$USER_ADDRESS&builderOnly=true" | jq '. | length'
echo ""

echo "PnL (builder-only):"
curl -s "$API_URL/v1/pnl?user=$USER_ADDRESS&builderOnly=true" | jq '.'
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Test Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
