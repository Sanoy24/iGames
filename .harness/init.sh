#!/usr/bin/env bash
# iGames Harness Bootstrap
# Run this at the start of a new session to verify the environment is ready.
# Usage: bash .harness/init.sh

set -e

INSTALL_CMD="npm install"
VERIFY_CMD="npx tsc --noEmit"
FRONTEND_VERIFY_CMD="cd frontend && npx tsc --noEmit && npm run build && cd .."
START_CMD="npm run start:dev"

echo "=== iGames Harness Init ==="
echo ""

# 1. Check Node version
echo "[1/6] Node version"
node --version
echo ""

# 2. Install backend dependencies
echo "[2/6] Backend dependencies"
$INSTALL_CMD
echo ""

# 3. Install frontend dependencies
echo "[3/6] Frontend dependencies"
(cd frontend && npm install)
echo ""

# 4. Backend type check
echo "[4/6] Backend type check (tsc --noEmit)"
$VERIFY_CMD
echo "      ✓ Backend types clean"
echo ""

# 5. Frontend type check + build
echo "[5/6] Frontend type check + build"
$FRONTEND_VERIFY_CMD
echo "      ✓ Frontend clean"
echo ""

# 6. Print current state
echo "[6/6] Current session state"
echo ""
if [ -f "PROGRESS.md" ]; then
  echo "--- PROGRESS.md (first 30 lines) ---"
  head -30 PROGRESS.md
  echo "..."
fi
echo ""

echo "=== Ready to work ==="
echo ""
echo "Next steps:"
echo "  1. Read PROGRESS.md for current state"
echo "  2. Check feature_list.json for next task (status: not_started or in_progress)"
echo "  3. Work on ONE feature at a time (WIP=1)"
echo "  4. Run verification command for each feature before marking passing"
echo "  5. Before closing: update PROGRESS.md and feature_list.json"
echo ""
echo "To start dev server: $START_CMD"
