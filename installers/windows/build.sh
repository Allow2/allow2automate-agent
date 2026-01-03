#!/bin/bash
set -e

echo "Building Windows installer..."

# Get version from environment variable (set by GitHub Actions from git tag)
# or fall back to package.json for local builds
if [ -z "$VERSION" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "Version from package.json: $VERSION"
else
    echo "Version from git tag: $VERSION"
fi

# Build the binary with pkg
echo "Building Windows binary..."
mkdir -p dist

npx pkg . --targets node18-win-x64 --output dist/allow2automate-agent-win.exe 2>&1 | tee pkg-output.log || {
    echo "Warning: pkg exited with error, checking if binary was created anyway..."
}

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
