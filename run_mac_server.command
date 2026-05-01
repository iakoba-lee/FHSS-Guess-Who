#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo " Starting FHSS Staff Matcher Server..."
echo "=========================================="
echo "Keep this window open to keep the server running."
echo "Press Ctrl+C to stop the server."
echo ""

# Start the Node.js server in the foreground
node server.js
