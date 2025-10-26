#!/bin/bash

echo "Testing backend startup..."
echo ""

# Start the backend in the background
pnpm run dev > /tmp/backend-test.log 2>&1 &
BACKEND_PID=$!

echo "Backend PID: $BACKEND_PID"
echo "Waiting for backend to start..."

# Wait up to 10 seconds for the backend to start
for i in {1..10}; do
  sleep 1
  if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Backend started successfully!"
    echo ""
    echo "Health check response:"
    curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
    echo ""
    
    # Kill the backend
    kill $BACKEND_PID 2>/dev/null
    wait $BACKEND_PID 2>/dev/null
    
    echo ""
    echo "✅ Backend test completed successfully"
    exit 0
  fi
  echo "  Attempt $i/10..."
done

echo "❌ Backend failed to start within 10 seconds"
echo ""
echo "Last 20 lines of log:"
tail -20 /tmp/backend-test.log

# Kill the backend if it's still running
kill $BACKEND_PID 2>/dev/null
wait $BACKEND_PID 2>/dev/null

exit 1
