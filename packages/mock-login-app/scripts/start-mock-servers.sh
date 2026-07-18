#!/bin/bash
# Start mock login apps for testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/../mock-login-app"

# Build the app if needed
if [ ! -d "$APP_DIR/dist" ]; then
    echo "Building mock login app..."
    cd "$APP_DIR" && pnpm install && pnpm build
fi

# Kill existing processes on ports
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3002 | xargs kill -9 2>/dev/null || true

# Start legacy server
echo "Starting Legacy Mock Login Server on port 3001..."
cd "$APP_DIR" && node dist/server.js --port=3001 --url=http://localhost:3001 --legacy &
LEGACY_PID=$!

# Wait a bit
sleep 2

# Start current server
echo "Starting Current Mock Login Server on port 3002..."
cd "$APP_DIR" && node dist/server.js --port=3002 --url=http://localhost:3002 --current &
CURRENT_PID=$!

echo ""
echo "Mock servers started:"
echo "  Legacy: http://localhost:3001 (PID: $LEGACY_PID)"
echo "  Current: http://localhost:3002 (PID: $CURRENT_PID)"
echo ""
echo "To stop: kill $LEGACY_PID $CURRENT_PID"
