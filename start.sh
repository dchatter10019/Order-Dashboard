#!/bin/bash

echo "🚀 Starting Bevvi Order Tracking System..."

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the frontend
echo "🔨 Building frontend..."
npm run build

# Start the server
echo "🌐 Starting server..."
npm start
