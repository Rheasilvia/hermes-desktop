#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --frozen --extra build
rm -rf build dist
uv run --frozen pyinstaller daemon.spec --noconfirm

# Arrange output for Tauri externalBin:
# Tauri looks for dist/daemon/daemon-<arch>-apple-darwin
ARCH=$(uname -m)
[[ "$ARCH" == "arm64" ]] && TRIPLE="aarch64-apple-darwin" || TRIPLE="x86_64-apple-darwin"
BINARY=dist/daemon
mkdir -p dist/daemon_staging
mv "$BINARY" dist/daemon_staging/daemon-$TRIPLE
rm -rf dist/daemon
mv dist/daemon_staging dist/daemon

# Smoke test
TMP_HOME="$(mktemp -d)"
HERMES_HOME="$TMP_HOME/.hermes" ./dist/daemon/daemon-$TRIPLE &
BPID=$!
sleep 2
if ! kill -0 "$BPID" 2>/dev/null; then
  wait "$BPID"
fi
kill $BPID || true
echo "Built: ./dist/daemon/daemon-$TRIPLE"
