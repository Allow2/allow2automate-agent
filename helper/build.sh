#!/bin/bash
set -e

echo "Building Allow2 Agent Helper..."

cd "$(dirname "$0")"

# Get version from parent package.json
if [ -z "$VERSION" ]; then
    VERSION=$(node -p "require('../package.json').version")
    echo "Version from package.json: $VERSION"
else
    echo "Version from environment: $VERSION"
fi

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Build binaries for all platforms
echo "Building binaries..."
mkdir -p dist

# Build for each platform
echo "Building macOS binary..."
npx pkg . --targets node18-macos-x64 --output dist/allow2automate-agent-helper-macos

echo "Building Linux binary..."
npx pkg . --targets node18-linux-x64 --output dist/allow2automate-agent-helper-linux

echo "Building Windows binary..."
npx pkg . --targets node18-win-x64 --output dist/allow2automate-agent-helper-win.exe

echo "✅ Helper binaries built successfully"
ls -lh dist/
