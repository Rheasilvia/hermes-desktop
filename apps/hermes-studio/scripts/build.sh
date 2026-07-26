#!/usr/bin/env bash
# Hermes Desktop — Cross-platform build script
# Usage: ./scripts/build.sh [win|windows|mac|macos|linux|all|current]
set -euo pipefail

PLATFORM="${1:-current}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== Hermes Desktop Build ==="
echo "Platform: $PLATFORM"
echo "Project:  $PROJECT_DIR"
echo ""

# Install dependencies
echo "[1/3] Installing dependencies..."
npm ci

# Type-check
echo "[2/3] Type-checking..."
npx tsc --noEmit

# Build
echo "[3/3] Building..."
case "$PLATFORM" in
  win|windows)
    echo "Building Windows NSIS installer..."
    npm run tauri build -- --bundles nsis
    ;;
  mac|macos)
    echo "Building macOS DMG..."
    npm run tauri build -- --bundles dmg
    ;;
  linux)
    echo "Building Linux packages (deb, rpm, AppImage)..."
    npm run tauri build -- --bundles deb,rpm,appimage
    ;;
  all)
    echo "Building all platform targets..."
    npm run tauri build
    ;;
  current|*)
    echo "Building for current platform..."
    npm run tauri build
    ;;
esac

echo ""
echo "=== Build complete ==="
echo "Artifacts in: $PROJECT_DIR/src-tauri/target/release/bundle/"
echo ""

# List produced artifacts
if [ -d "src-tauri/target/release/bundle" ]; then
  echo "Produced artifacts:"
  find src-tauri/target/release/bundle -maxdepth 2 -type f \( -name "*.deb" -o -name "*.rpm" -o -name "*.AppImage" -o -name "*.dmg" -o -name "*.exe" -o -name "*.msi" -o -name "*.app" \) 2>/dev/null | while read -r f; do
    SIZE=$(du -h "$f" | cut -f1)
    echo "  $SIZE  $f"
  done || true
fi
