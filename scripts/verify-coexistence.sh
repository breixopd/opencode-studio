#!/bin/bash
# opencode-studio tunnel verification (SSH forward health only)

set -e

PORT="${STUDIO_TUNNEL_PORT:-8443}"
FAIL=0

echo "=== opencode-studio Tunnel Verification ==="
echo ""

echo "--- SSH tunnel (port $PORT) ---"
if curl -s --max-time 3 "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  echo "Port $PORT: reachable"
else
  echo "Port $PORT: not listening (tunnel may start on session.created)"
  FAIL=1
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== TUNNEL: OK ==="
  exit 0
else
  echo "=== TUNNEL: not running (use studio_tunnel_restart) ==="
  exit 0
fi
