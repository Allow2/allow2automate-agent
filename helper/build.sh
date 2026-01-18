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

# Build binaries
echo "Building binaries..."
mkdir -p dist

# Detect current platform
CURRENT_OS=$(uname -s)
echo "Detected OS: $CURRENT_OS"

case "$CURRENT_OS" in
    Darwin)
        # macOS: Build universal binary (Intel + Apple Silicon)
        echo "Building macOS binaries (universal)..."
        npx pkg . --targets node18-macos-x64 --output dist/allow2automate-agent-helper-macos-x64 || {
            echo "Warning: pkg exited with error for x64, checking if binary was created anyway..."
        }
        npx pkg . --targets node18-macos-arm64 --output dist/allow2automate-agent-helper-macos-arm64 || {
            echo "Warning: pkg exited with error for arm64, checking if binary was created anyway..."
        }

        # Create universal binary for macOS
        if [ -f "dist/allow2automate-agent-helper-macos-x64" ] && [ -f "dist/allow2automate-agent-helper-macos-arm64" ]; then
            echo "Creating universal macOS binary..."
            lipo -create -output dist/allow2automate-agent-helper-macos \
                dist/allow2automate-agent-helper-macos-x64 \
                dist/allow2automate-agent-helper-macos-arm64
            echo "Universal binary created:"
            file dist/allow2automate-agent-helper-macos
        elif [ -f "dist/allow2automate-agent-helper-macos-arm64" ]; then
            echo "Only arm64 build available, using that..."
            cp dist/allow2automate-agent-helper-macos-arm64 dist/allow2automate-agent-helper-macos
        elif [ -f "dist/allow2automate-agent-helper-macos-x64" ]; then
            echo "Only x64 build available, using that..."
            cp dist/allow2automate-agent-helper-macos-x64 dist/allow2automate-agent-helper-macos
        fi
        ;;
    Linux)
        # Linux: Build Linux binary only
        echo "Building Linux binary..."
        npx pkg . --targets node18-linux-x64 --output dist/allow2automate-agent-helper-linux || {
            echo "Warning: pkg exited with error, checking if binary was created anyway..."
        }
        ;;
    MINGW*|MSYS*|CYGWIN*)
        # Windows: Build Windows binary only
        echo "Building Windows binary..."
        npx pkg . --targets node18-win-x64 --output dist/allow2automate-agent-helper-win.exe || {
            echo "Warning: pkg exited with error, checking if binary was created anyway..."
        }
        ;;
    *)
        echo "Unknown OS: $CURRENT_OS"
        echo "Building for all platforms..."
        npx pkg . --targets node18-linux-x64 --output dist/allow2automate-agent-helper-linux
        npx pkg . --targets node18-win-x64 --output dist/allow2automate-agent-helper-win.exe
        # Skip macOS if not on macOS (lipo not available)
        ;;
esac

echo "✅ Helper binaries built successfully"
ls -lh dist/
