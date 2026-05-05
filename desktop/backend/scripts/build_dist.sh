#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m venv .venv-build
source .venv-build/bin/activate
pip install -e ".[build]"
rm -rf build dist
pyinstaller desktop_backend.spec --noconfirm

TMP_HOME="$(mktemp -d)"
HERMES_HOME="$TMP_HOME/.hermes" ./dist/desktop_backend/desktop_backend &
BPID=$!
sleep 2
kill $BPID || true
echo "Built: ./dist/desktop_backend/"
