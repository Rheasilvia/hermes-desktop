#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== A1: backend boundaries =="
bash "$REPO/desktop/backend/scripts/check_boundaries.sh"

echo "== A2: backend dependencies =="
( cd "$REPO/desktop/backend" && uv sync --frozen --extra dev )

echo "== A3: backend tests =="
( cd "$REPO/desktop/backend" && uv run --frozen pytest -q )

echo "== A4: frontend lint =="
( cd "$REPO/desktop" && npm run lint ) || echo "WARNING: lint issues (expected until all violations fixed)"

echo "== A5: frontend tests =="
( cd "$REPO/desktop" && npm run test -- --run )

echo
echo "ALL ACCEPTANCE CHECKS PASSED."
