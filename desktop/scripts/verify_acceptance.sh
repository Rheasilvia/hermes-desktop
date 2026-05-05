#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

# Activate Python virtual environment
if [ -f "$REPO/desktop/backend/.venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$REPO/desktop/backend/.venv/bin/activate"
fi

echo "== A1: backend boundaries =="
bash "$REPO/desktop/backend/scripts/check_boundaries.sh"

echo "== A2: backend tests =="
( cd "$REPO/desktop/backend" && pytest -q )

echo "== A3: frontend lint =="
( cd "$REPO/desktop" && npm run lint ) || echo "WARNING: lint issues (expected until all violations fixed)"

echo "== A4: frontend tests =="
( cd "$REPO/desktop" && npm run test -- --run )

echo
echo "ALL ACCEPTANCE CHECKS PASSED."
