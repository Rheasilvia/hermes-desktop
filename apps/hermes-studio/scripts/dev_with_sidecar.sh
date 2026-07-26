#!/usr/bin/env bash
# Compatibility entrypoint for local Hermes Studio development. Electron main
# owns the random token, port-zero sidecar, health checks, and cleanup.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_ROOT"
exec npm run dev
