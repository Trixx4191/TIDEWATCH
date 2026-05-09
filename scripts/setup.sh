#!/bin/bash
# =============================================================================
# TIDEWATCH — Project Setup Script
# Installs all dependencies and creates required directories
# =============================================================================

set -e  # Exit on any error

GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  🌊  TIDEWATCH SETUP                      ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# ── CHECK PREREQUISITES ───────────────────────────────────────────────────────
echo -e "${AMBER}[1/5] Checking prerequisites...${RESET}"

command -v python3 >/dev/null 2>&1 || {
  echo -e "${RED}✗ Python 3 not found. Install from https://python.org${RESET}"
  exit 1
}
echo -e "${GREEN}  ✓ Python $(python3 --version)${RESET}"

command -v node >/dev/null 2>&1 || {
  echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${RESET}"
  exit 1
}
echo -e "${GREEN}  ✓ Node $(node --version)${RESET}"

command -v npm >/dev/null 2>&1 || {
  echo -e "${RED}✗ npm not found. Install Node.js from https://nodejs.org${RESET}"
  exit 1
}
echo -e "${GREEN}  ✓ npm $(npm --version)${RESET}"

# ── CREATE DIRECTORIES ────────────────────────────────────────────────────────
echo ""
echo -e "${AMBER}[2/5] Creating project directories...${RESET}"
mkdir -p data/processed
mkdir -p data/raw
mkdir -p frontend/assets/icons
echo -e "${GREEN}  ✓ Directories created${RESET}"

# ── ENV FILE ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${AMBER}[3/5] Setting up environment...${RESET}"
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "${GREEN}  ✓ .env created from .env.example${RESET}"
  echo -e "${AMBER}  ⚠ Edit .env with your NASA Earthdata + NOAA API credentials${RESET}"
else
  echo -e "${GREEN}  ✓ .env already exists${RESET}"
fi

# ── PYTHON DEPENDENCIES ───────────────────────────────────────────────────────
echo ""
echo -e "${AMBER}[4/5] Installing Python dependencies...${RESET}"
pip3 install -r requirements.txt --quiet
echo -e "${GREEN}  ✓ Python packages installed${RESET}"

# ── NODE DEPENDENCIES ─────────────────────────────────────────────────────────
echo ""
echo -e "${AMBER}[5/5] Installing Node.js dependencies...${RESET}"
npm install --silent
echo -e "${GREEN}  ✓ Node packages installed${RESET}"

# ── DONE ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║  Setup complete!                          ║${RESET}"
echo -e "${CYAN}╠══════════════════════════════════════════╣${RESET}"
echo -e "${CYAN}║  Next steps:                              ║${RESET}"
echo -e "${CYAN}║  1. Edit .env with your API credentials   ║${RESET}"
echo -e "${CYAN}║  2. python data/build_dataset.py          ║${RESET}"
echo -e "${CYAN}║  3. node backend/server.js                ║${RESET}"
echo -e "${CYAN}║  4. Open http://localhost:3000            ║${RESET}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""
