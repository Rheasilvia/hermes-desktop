#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
APP_ROOT="$REPO/apps/hermes-studio"

echo "== A1: backend boundaries =="
bash "$APP_ROOT/sidecar/scripts/check_boundaries.sh"

echo "== A2: backend dependencies =="
( cd "$APP_ROOT/sidecar" && uv sync --frozen --extra dev )

echo "== A3: backend tests =="
( cd "$APP_ROOT/sidecar" && uv run --frozen --extra dev pytest -q )

echo "== A4: frontend lint =="
( cd "$APP_ROOT" && npm run lint )

echo "== A5: frontend tests =="
( cd "$APP_ROOT" && npm run test -- --run )

echo
echo "ALL ACCEPTANCE CHECKS PASSED."
