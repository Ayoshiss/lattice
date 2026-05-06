#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║     Lattice Demo  —  starting up      ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Kill any stale processes
lsof -ti :7402 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
sleep 1

# Start relay in background
echo "▶  Starting relay  (port 7402)…"
cd "$ROOT/relay"
npx ts-node src/server.ts > /tmp/lattice-relay.log 2>&1 &
RELAY_PID=$!
echo "   relay PID: $RELAY_PID"

# Wait for relay to be ready
for i in $(seq 1 15); do
  if curl -sf http://localhost:7402/health > /dev/null 2>&1; then
    echo "   relay ✓ ready"
    break
  fi
  sleep 1
done

# Start web frontend
echo ""
echo "▶  Starting web frontend  (port 3000)…"
cd "$ROOT/web"
yarn dev > /tmp/lattice-web.log 2>&1 &
WEB_PID=$!
echo "   web PID: $WEB_PID"

# Wait for Next.js
for i in $(seq 1 20); do
  if curl -sf http://localhost:3000/demo > /dev/null 2>&1; then
    echo "   web ✓ ready"
    break
  fi
  sleep 1
done

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  Demo live →  http://localhost:3000   ║"
echo "║  Relay   →  http://localhost:7402     ║"
echo "║                                       ║"
echo "║  Logs:  /tmp/lattice-relay.log        ║"
echo "║         /tmp/lattice-web.log          ║"
echo "║                                       ║"
echo "║  Ctrl-C to stop                       ║"
echo "╚═══════════════════════════════════════╝"
echo ""

trap "kill $RELAY_PID $WEB_PID 2>/dev/null; echo 'stopped.'; exit 0" INT TERM
wait
