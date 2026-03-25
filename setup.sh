#!/usr/bin/env bash
# CraftLaunch setup script for macOS / Linux
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "==> CraftLaunch Setup"
echo ""

# ── Python deps ────────────────────────────────────────────────────────────
echo "==> Installing Python dependencies…"
cd "$BACKEND_DIR"
pip3 install -r requirements.txt --break-system-packages 2>/dev/null || pip3 install -r requirements.txt

# ── Node deps ──────────────────────────────────────────────────────────────
echo ""
echo "==> Installing Node.js dependencies…"
cd "$FRONTEND_DIR"

if ! command -v npm &>/dev/null; then
    echo "ERROR: npm not found. Please install Node.js 18+ from nodejs.org"
    exit 1
fi

npm install

# ── Build frontend ─────────────────────────────────────────────────────────
echo ""
echo "==> Building React frontend…"
npx vite build

echo ""
echo "==> Done! Run with:"
echo "    python3 backend/main.py"
echo ""
echo "    Or for development (hot-reload):"
echo "    cd frontend && npx vite dev    # terminal 1"
echo "    python3 backend/main.py --dev  # terminal 2"
