#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/desktop_backend"

FORBIDDEN='^(from|import) +(hermes_cli|cron|agent|tui_gateway|web)\b'
if grep -RIEn "$FORBIDDEN" "$PKG" --include='*.py'; then
  echo "ERROR: desktop_backend must not import upstream modules (D6)" >&2
  exit 1
fi

shopt -s nullglob
missing=0
for f in "$PKG/readers"/*.py; do
  base="$(basename "$f")"
  [ "$base" = "__init__.py" ] && continue
  if ! head -n 5 "$f" | grep -q '^# SNAPSHOT:'; then
    echo "ERROR: missing SNAPSHOT header: $f" >&2
    missing=$((missing + 1))
  fi
done
[ "$missing" -gt 0 ] && exit 1
echo "OK: no upstream imports; all readers carry SNAPSHOT header."
