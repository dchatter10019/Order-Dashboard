#!/bin/bash

echo "🚀 Starting Bevvi Order Tracking System in development mode..."

# Kill any existing processes on ports 3000 and 3001
echo "🧹 Cleaning up existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Start the backend server in the background
echo "🌐 Starting backend server on port 3001..."
node server.js &
BACKEND_PID=$!

# Wait for backend to start
sleep 3

# Start the frontend development server
echo "⚛️  Starting frontend development server on port 3000..."
npm run dev &
FRONTEND_PID=$!

echo "✅ Both servers are starting..."
echo "📱 Frontend: http://localhost:3000"
echo "🔧 Backend:  http://localhost:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user to stop
wait

# Cleanup
echo "🧹 Stopping servers..."
kill $BACKEND_PID 2>/dev/null || true
kill $FRONTEND_PID 2>/dev/null || true
echo "✅ Servers stopped"
