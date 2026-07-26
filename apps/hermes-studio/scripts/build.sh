#!/usr/bin/env bash
# Hermes Studio — host-native Electron installer build.
# Usage: ./scripts/build.sh [win|windows|mac|macos|linux|current]
set -euo pipefail

REQUESTED="${1:-current}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_PLATFORM="$(node -p 'process.platform')"

case "$REQUESTED" in
  current)
    case "$HOST_PLATFORM" in
      darwin) TARGET="mac" ;;
      win32) TARGET="win" ;;
      linux) TARGET="linux" ;;
      *) echo "Unsupported host platform: $HOST_PLATFORM" >&2; exit 2 ;;
    esac
    ;;
  mac|macos) TARGET="mac" ;;
  win|windows) TARGET="win" ;;
  linux) TARGET="linux" ;;
  all)
    echo "Cross-platform sidecars are unsupported; run this script on each native host." >&2
    exit 2
    ;;
  *) echo "Unknown target: $REQUESTED" >&2; exit 2 ;;
esac

case "$TARGET:$HOST_PLATFORM" in
  mac:darwin|win:win32|linux:linux) ;;
  *)
    echo "Target $TARGET must be built on its native host (current: $HOST_PLATFORM)." >&2
    exit 2
    ;;
esac

cd "$PROJECT_DIR"

echo "=== Hermes Studio native build ($TARGET) ==="
echo "[1/3] Installing workspace dependencies..."
npm ci
echo "[2/3] Running Studio checks..."
npm run check
echo "[3/3] Building sidecar and installers..."
npm run "dist:$TARGET"

echo "=== Build complete ==="
echo "Artifacts in: $PROJECT_DIR/release/"
find release -maxdepth 1 -type f \( \
  -name 'Hermes-Studio-*.dmg' -o \
  -name 'Hermes-Studio-*.exe' -o \
  -name 'Hermes-Studio-*.AppImage' -o \
  -name 'Hermes-Studio-*.deb' -o \
  -name 'Hermes-Studio-*.rpm' \
\) -print 2>/dev/null || true
