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

# Ensure binary has consistent name for Inno Setup (skip if already correct)
TARGET="dist/allow2automate-agent-win.exe"
if [ "$BINARY" != "$TARGET" ]; then
    cp "$BINARY" "$TARGET"
fi

# Copy versioned binary to installer dist folder
cp "$BINARY" "$DIST_DIR/allow2automate-agent-${VERSION}.exe"

# Build helper application
echo "Building helper application..."
cd helper
bash build.sh
cd ..

# Copy helper binary to both locations
echo "Including helper binary in package..."
if [ -f "helper/dist/allow2automate-agent-helper-win.exe" ]; then
    cp helper/dist/allow2automate-agent-helper-win.exe "dist/allow2automate-agent-helper-win.exe"
    cp helper/dist/allow2automate-agent-helper-win.exe "$DIST_DIR/allow2automate-agent-helper-${VERSION}.exe"
else
    echo "Warning: Helper binary not found, skipping..."
fi

# Copy helper autostart scripts
if [ -f "helper/autostart/windows/install-autostart.bat" ]; then
    cp helper/autostart/windows/install-autostart.bat "$DIST_DIR/"
    cp helper/autostart/windows/remove-autostart.bat "$DIST_DIR/"
fi

echo "✅ Windows binaries created:"
echo "   - Main agent: dist/allow2automate-agent-win.exe"
if [ -f "dist/allow2automate-agent-helper-win.exe" ]; then
    echo "   - Helper: dist/allow2automate-agent-helper-win.exe"
fi
echo ""
echo "Files in dist/ (for Inno Setup):"
ls -lh dist/*.exe 2>/dev/null || echo "  (no exe files)"
echo ""
echo "Files in $DIST_DIR (versioned):"
ls -lh "$DIST_DIR"/*.exe 2>/dev/null || echo "  (no exe files)"
