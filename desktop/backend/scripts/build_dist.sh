#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --frozen --extra build
rm -rf build dist
uv run --frozen pyinstaller desktop_backend.spec --noconfirm

# Arrange output for Tauri externalBin:
# Tauri looks for dist/desktop_backend/desktop_backend-<arch>-apple-darwin
ARCH=$(uname -m)
[[ "$ARCH" == "arm64" ]] && TRIPLE="aarch64-apple-darwin" || TRIPLE="x86_64-apple-darwin"
BINARY=dist/desktop_backend
mkdir -p dist/desktop_backend_staging
mv "$BINARY" dist/desktop_backend_staging/desktop_backend-$TRIPLE
rm -rf dist/desktop_backend
mv dist/desktop_backend_staging dist/desktop_backend

# Smoke test
TMP_HOME="$(mktemp -d)"
HERMES_HOME="$TMP_HOME/.hermes" ./dist/desktop_backend/desktop_backend-$TRIPLE &
BPID=$!
sleep 2
kill $BPID || true
echo "Built: ./dist/desktop_backend/desktop_backend-$TRIPLE"
