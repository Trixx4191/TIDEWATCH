#!/bin/bash
# =============================================================================
# TIDEWATCH — Development Runner
# Starts backend API server and opens frontend in browser
# =============================================================================

set -e

GREEN='\033[0;32m'
AMBER='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  🌊  TIDEWATCH — DEV MODE                 ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# Check .env exists
if [ ! -f .env ]; then
  echo -e "${AMBER}⚠ No .env found — copying from .env.example${RESET}"
  cp .env.example .env
fi

# Check node_modules
if [ ! -d node_modules ]; then
  echo -e "${AMBER}Installing Node dependencies...${RESET}"
  npm install --silent
fi

PORT=${PORT:-3000}

echo -e "${GREEN}Starting backend on port ${PORT}...${RESET}"
echo -e "${GREEN}Frontend: http://localhost:${PORT}${RESET}"
echo -e "${GREEN}API health: http://localhost:${PORT}/api/health${RESET}"
echo -e "${AMBER}Press Ctrl+C to stop${RESET}"
echo ""

# Start server — use nodemon if available, else node
if command -v nodemon &>/dev/null; then
  nodemon backend/server.js
else
  node backend/server.js
fi
