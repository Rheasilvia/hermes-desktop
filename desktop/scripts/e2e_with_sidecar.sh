#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DESKTOP_E2E_SIDECAR_PORT:-18180}"
TOKEN="${DESKTOP_E2E_SIDECAR_TOKEN:-playwright-secret}"
HERMES_HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hermes-desktop-e2e.XXXXXX")"
SIDECAR_STDOUT="$(mktemp "${TMPDIR:-/tmp}/hermes-sidecar-out.XXXXXX")"
SIDECAR_STDERR="$(mktemp "${TMPDIR:-/tmp}/hermes-sidecar-err.XXXXXX")"

collect_descendant_pids() {
  local parent_pid="$1"
  local child_pid

  for child_pid in $(pgrep -P "$parent_pid" 2>/dev/null || true); do
    collect_descendant_pids "$child_pid"
    printf '%s\n' "$child_pid"
  done
}

terminate_sidecar_tree() {
  if [ -z "${SIDECAR_PID:-}" ]; then
    return
  fi

  local descendants
  descendants="$(collect_descendant_pids "$SIDECAR_PID" || true)"

  local pids=()
  local pid
  for pid in $descendants; do
    pids+=("$pid")
  done
  pids+=("$SIDECAR_PID")

  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait "$SIDECAR_PID" 2>/dev/null || true

  local survivors=()
  for pid in $descendants; do
    if kill -0 "$pid" 2>/dev/null; then
      survivors+=("$pid")
    fi
  done

  if [ "${#survivors[@]}" -gt 0 ]; then
    kill -KILL "${survivors[@]}" 2>/dev/null || true
  fi
}

cleanup() {
  terminate_sidecar_tree
  rm -rf "$HERMES_HOME_DIR"
  rm -f "$SIDECAR_STDOUT" "$SIDECAR_STDERR"
}
trap cleanup EXIT INT TERM

auth_header=(-H "Authorization: Bearer $TOKEN")
json_header=(-H "Content-Type: application/json")
base_url="http://127.0.0.1:$PORT"

cat >"$HERMES_HOME_DIR/config.yaml" <<'YAML'
model:
  provider: e2e-alpha
  default: e2e-alpha-primary
providers:
  e2e-alpha:
    name: E2E Alpha
    base_url: http://127.0.0.1:9/v1
    api_key: sk-e2e-alpha
    discover_models: false
    default_model: e2e-alpha-primary
    models:
      e2e-alpha-primary: {}
      e2e-alpha-secondary: {}
  e2e-beta:
    name: E2E Beta
    base_url: http://127.0.0.1:9/v1
    api_key: sk-e2e-beta
    discover_models: false
    default_model: e2e-beta-primary
    models:
      e2e-beta-primary: {}
      e2e-beta-secondary: {}
YAML

echo "==> Starting desktop sidecar for Playwright on $base_url"
(
  cd "$ROOT/sidecar"
  HERMES_HOME="$HERMES_HOME_DIR" \
    DESKTOP_BACKEND_PORT="$PORT" \
    DESKTOP_BACKEND_TOKEN="$TOKEN" \
    uv run --frozen python -m daemon
) >"$SIDECAR_STDOUT" 2>"$SIDECAR_STDERR" &
SIDECAR_PID=$!

for _ in $(seq 1 120); do
  if curl -fsS "${auth_header[@]}" "$base_url/desktop/api/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "Sidecar exited before becoming healthy." >&2
    cat "$SIDECAR_STDOUT" >&2 || true
    cat "$SIDECAR_STDERR" >&2 || true
    exit 1
  fi
  sleep 0.25
done

if ! curl -fsS "${auth_header[@]}" "$base_url/desktop/api/health" >/dev/null; then
  echo "Timed out waiting for sidecar health." >&2
  cat "$SIDECAR_STDOUT" >&2 || true
  cat "$SIDECAR_STDERR" >&2 || true
  exit 1
fi

providers_json="$(curl -fsS "${auth_header[@]}" "$base_url/desktop/api/model/providers?configured_only=false")"
seed_json="$(PROVIDERS_JSON="$providers_json" node - <<'NODE'
const payload = JSON.parse(process.env.PROVIDERS_JSON || '{}');
const providers = Array.isArray(payload.items) ? payload.items : [];
const candidates = providers
  .map((provider) => ({
    id: String(provider.id || provider.name || ''),
    name: String(provider.name || provider.id || ''),
    models: Array.isArray(provider.models) ? provider.models : [],
  }))
  .filter((provider) => provider.id.startsWith('e2e-') && provider.name && provider.models.length > 0)
  .slice(0, 2);

if (candidates.length < 2) {
  console.error('Need two seeded e2e providers with models for desktop E2E.');
  console.error(JSON.stringify(providers.map((p) => ({ id: p.id, name: p.name, models: p.models?.length ?? 0 })), null, 2));
  process.exit(1);
}

const pickModel = (provider) => {
  const raw = provider.models[0];
  if (raw && typeof raw === 'object') return String(raw.name || raw.id || raw.display_name || '');
  return String(raw || '');
};

const seeded = candidates.map((provider) => ({
  id: provider.id,
  name: provider.name,
  model: pickModel(provider),
}));

if (seeded.some((provider) => !provider.model)) {
  console.error('Unable to derive model ids for seeded providers.');
  console.error(JSON.stringify(seeded, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(seeded));
NODE
)"

node - "$base_url" "$TOKEN" "$seed_json" <<'NODE'
const [baseUrl, token, seedJson] = process.argv.slice(2);
const providers = JSON.parse(seedJson);

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${init.method || 'GET'} ${path} -> ${response.status}: ${body}`);
  }
  return response.json().catch(() => ({}));
}

for (const provider of providers) {
  await request('/desktop/api/model/providers', {
    method: 'POST',
    body: JSON.stringify({
      name: provider.id,
      api_key: `sk-e2e-${provider.id}`,
      display_name: provider.name,
      is_builtin: true,
    }),
  });
}

await request('/desktop/api/model/active', {
  method: 'PUT',
  body: JSON.stringify({ provider: providers[0].id, model: providers[0].model }),
});
NODE

echo "==> Seeded desktop sidecar model providers for Playwright"
cd "$ROOT"
VITE_SIDECAR_URL="$base_url" \
  VITE_SIDECAR_TOKEN="$TOKEN" \
  npm run dev
