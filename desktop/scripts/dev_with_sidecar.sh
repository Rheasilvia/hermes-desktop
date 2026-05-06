#!/usr/bin/env bash
# 本地完整验证：启动 Python 侧车 + Vite dev server（不需要 Tauri）
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

cleanup() {
  if [ -n "${SIDECAR_PID:-}" ]; then
    kill "$SIDECAR_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup INT TERM EXIT

echo "==> 创建 token..."
mkdir -p ~/.hermes/desktop
echo "dev-token" > ~/.hermes/desktop/sidecar.token
chmod 600 ~/.hermes/desktop/sidecar.token

echo "==> 启动 Python 侧车..."
cd "$REPO/desktop/backend"
source .venv/bin/activate
python -m desktop_backend > /tmp/sidecar_stdout.txt 2>/dev/null &
SIDECAR_PID=$!

# 等待 READY
for i in $(seq 1 30); do
  if grep -q "READY" /tmp/sidecar_stdout.txt 2>/dev/null; then
    break
  fi
  sleep 0.2
done
PORT=$(grep -oP 'READY \K\d+' /tmp/sidecar_stdout.txt)
echo "==> 侧车就绪: http://127.0.0.1:$PORT"

# 写入实际端口
cat > "$REPO/desktop/.env.development.local" << EOF
VITE_API_MODE=http
VITE_SIDECAR_URL=http://127.0.0.1:$PORT
VITE_SIDECAR_TOKEN=dev-token
EOF

echo "==> 启动 Vite dev server..."
cd "$REPO/desktop"
npm run dev
