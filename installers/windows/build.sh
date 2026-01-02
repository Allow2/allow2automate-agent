#!/bin/bash
set -e

echo "Building Windows installer..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"

# Build the binary with pkg
echo "Building Windows binary..."
npx pkg . --targets node18-win-x64 --out-path dist --output dist/allow2automate-agent-win.exe

# Create installer directory
DIST_DIR="installers/windows/dist"
mkdir -p "$DIST_DIR"

# List what was actually built (for debugging)
echo "Built binaries:"
ls -la dist/

# Copy binary (find it regardless of exact name)
BINARY=$(find dist -name "*allow2automate-agent*.exe" -type f | head -n 1)
if [ -z "$BINARY" ]; then
    echo "Error: No binary found in dist/"
    exit 1
fi
echo "Using binary: $BINARY"
cp "$BINARY" "$DIST_DIR/allow2automate-agent-${VERSION}.exe"

echo "✅ Windows binary created: $DIST_DIR/allow2automate-agent-${VERSION}.exe"
echo "   Note: For full MSI installer, WiX Toolset integration needed"
ls -lh "$DIST_DIR"/*.exe
