#!/bin/bash

echo "🚀 Starting Bevvi Order Tracking System..."

# Kill any existing processes on ports 3001 and 5000
echo "🧹 Cleaning up existing processes..."
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:5000 | xargs kill -9 2>/dev/null || true

# Build the frontend if needed
if [ ! -d "dist" ]; then
    echo "🔨 Building frontend..."
    npm run build
fi

# Start the server
echo "🌐 Starting server on port 3001..."
echo "📱 Access your system at: http://localhost:3001"
echo "🔑 Login with: Bevvi_User / Bevvi_123#"
echo ""
echo "Press Ctrl+C to stop the server"

# Start the server
npm start
