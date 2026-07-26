#!/usr/bin/env bash
# Fail if any *.module.css under desktop/src contains a hardcoded color
# literal (hex or rgb/rgba) that isn't annotated with the `literal-ok`
# escape comment.
#
# Theme files under desktop/src/styles/themes/ define the literal palette
# values and are exempt.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${ROOT}/src"

# Pattern matches:
#   #abc / #abcd / #aabbcc / #aabbccdd  (any 3/4/6/8-digit hex)
#   rgb(...) / rgba(...)
HEX_RE='#[0-9a-fA-F]{3,8}\b'
RGB_RE='rgba?\('

violations=$(grep -rEn "${HEX_RE}|${RGB_RE}" \
  --include='*.module.css' \
  "${TARGET}" \
  | grep -v 'var(--' \
  | grep -v 'literal-ok' \
  || true)

if [[ -n "${violations}" ]]; then
  echo "✗ Hardcoded colors found in CSS modules:"
  echo
  echo "${violations}"
  echo
  echo "Fix: replace the literal with a design token from src/styles/tokens.css,"
  echo "or annotate the line with a /* literal-ok: <reason> */ comment."
  exit 1
fi

echo "✓ All CSS modules use design tokens (or are explicitly literal-ok)."
