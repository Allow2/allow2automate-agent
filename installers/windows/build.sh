#!/bin/bash
set -e

echo "Building Windows installer..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"

# Build the binary with pkg
echo "Building Windows binary..."
npx pkg . --targets node18-win-x64 --out-path dist

# Create installer directory
DIST_DIR="installers/windows/dist"
mkdir -p "$DIST_DIR"

# For now, just copy the binary - we can add NSIS/WiX wrapper later
cp dist/allow2automate-agent-win.exe "$DIST_DIR/allow2automate-agent-${VERSION}.exe"

echo "✅ Windows binary created: $DIST_DIR/allow2automate-agent-${VERSION}.exe"
echo "   Note: For full MSI installer, WiX Toolset integration needed"
ls -lh "$DIST_DIR"/*.exe
