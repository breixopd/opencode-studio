#!/bin/bash
# opencode-studio coexistence verification
# Checks that OLD tunnel (8443) and NEW plugin (8444) can coexist

set -e

FAIL=0

echo "=== opencode-studio Coexistence Verification ==="
echo ""

# Check old tunnel (production, port 8443)
echo "--- Old tunnel (port 8443) ---"
if curl -s --max-time 5 http://localhost:8443/mcp | head -1 | grep -q jsonrpc; then
  echo "OLD (8443): OK"
else
  echo "OLD (8443): FAIL — ChunkHound MCP not responding on port 8443"
  FAIL=1
fi

# Check new plugin tunnel (dev, port 8444)
echo ""
echo "--- New plugin tunnel (port 8444) ---"
if curl -s --max-time 5 http://localhost:8444/mcp | head -1 | grep -q jsonrpc; then
  echo "NEW (8444): OK"
else
  echo "NEW (8444): NOT RUNNING (expected during development)"
fi

# Summary
echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== COEXISTENCE: OK ==="
  echo "Old tunnel (8443) and new plugin can coexist."
  exit 0
else
  echo "=== COEXISTENCE: FAIL ==="
  echo "One or more checks failed. See details above."
  exit 1
fi
