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
READY_LOG="$TMP_HOME/sidecar-ready.log"
ERR_LOG="$TMP_HOME/sidecar-error.log"
TOKEN="sidecar-smoke-token"
PORT="$(
  uv run --frozen python - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
)"
HERMES_HOME="$TMP_HOME/.hermes" \
  DESKTOP_BACKEND_TOKEN="$TOKEN" \
  DESKTOP_BACKEND_PORT="$PORT" \
  ./dist/daemon/daemon-$TRIPLE >"$READY_LOG" 2>"$ERR_LOG" &
BPID=$!
cleanup() {
  kill "$BPID" 2>/dev/null || true
  wait "$BPID" 2>/dev/null || true
  rm -rf "$TMP_HOME"
}
trap cleanup EXIT
READY_ATTEMPTS=900
for _ in $(seq 1 "$READY_ATTEMPTS"); do
  if grep -q "^READY " "$READY_LOG"; then
    break
  fi
  if ! kill -0 "$BPID" 2>/dev/null; then
    cat "$ERR_LOG" >&2 || true
    wait "$BPID"
  fi
  sleep 0.1
done
if ! grep -q "^READY " "$READY_LOG"; then
  echo "sidecar smoke failed: READY line not emitted" >&2
  cat "$ERR_LOG" >&2 || true
  exit 1
fi
curl --fail --silent --show-error --max-time 10 \
  "http://127.0.0.1:$PORT/desktop/api/health" >/dev/null
TOOLSETS_JSON="$(
  curl --fail --silent --show-error --max-time 20 \
    -H "Authorization: Bearer $TOKEN" \
    "http://127.0.0.1:$PORT/desktop/api/toolsets"
)"
TOOLSETS_JSON="$TOOLSETS_JSON" uv run --frozen python - <<'PY'
import json
import os

payload = json.loads(os.environ["TOOLSETS_JSON"])
if payload.get("error"):
    raise SystemExit(f"toolsets smoke failed: {payload.get('error')}")
if not isinstance(payload.get("items"), list):
    raise SystemExit("toolsets smoke failed: items is not a list")
PY
echo "Built: ./dist/daemon/daemon-$TRIPLE"
