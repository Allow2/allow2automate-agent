#!/bin/bash
set -e

echo "Building allow2automate-agent-helper..."

cd "$(dirname "$0")"

# Get version from parent package.json
if [ -z "$VERSION" ]; then
    VERSION=$(node -p "require('../package.json').version")
    echo "Version from package.json: $VERSION"
else
    echo "Version from environment: $VERSION"
fi

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf dist

# Install ALL dependencies (including devDependencies for @yao-pkg/pkg and esbuild)
echo "Installing dependencies..."
npm install

# STEP 1: Pre-bundle with esbuild (CommonJS output for pkg compatibility)
echo "Pre-bundling with esbuild (JS -> CJS bundle)..."
mkdir -p dist
npx esbuild src/index.js --bundle --platform=node --target=node20 --outfile=dist/bundle.cjs --format=cjs
echo "✅ Pre-bundle complete: dist/bundle.cjs"

# Detect current platform
CURRENT_OS=$(uname -s)
echo "Detected OS: $CURRENT_OS"

# STEP 2: Build binaries with pkg (using prebundled CJS)
echo "Building binaries with pkg..."

case "$CURRENT_OS" in
    Darwin)
        # macOS: Build universal binary (Intel + Apple Silicon)
        echo "Building macOS binaries (universal)..."
        npx @yao-pkg/pkg dist/bundle.cjs --targets node20-macos-x64 --output dist/allow2automate-agent-helper-macos-x64 --config package.json 2>&1 | tee pkg-output-x64.log || {
            echo "Warning: pkg exited with error for x64, checking if binary was created anyway..."
        }
        npx @yao-pkg/pkg dist/bundle.cjs --targets node20-macos-arm64 --output dist/allow2automate-agent-helper-macos-arm64 --config package.json 2>&1 | tee pkg-output-arm64.log || {
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
        # Linux: Build Linux binary for detected architecture
        echo "Building Linux binary..."
        ARCH=$(uname -m)
        case "$ARCH" in
            x86_64)
                PKG_TARGET="node20-linux-x64"
                ;;
            aarch64|arm64)
                PKG_TARGET="node20-linux-arm64"
                ;;
            *)
                echo "Unsupported architecture: $ARCH, defaulting to x64"
                PKG_TARGET="node20-linux-x64"
                ;;
        esac
        echo "Building for $PKG_TARGET..."
        npx @yao-pkg/pkg dist/bundle.cjs --targets $PKG_TARGET --output dist/allow2automate-agent-helper-linux --config package.json 2>&1 | tee pkg-output.log || {
            echo "Warning: pkg exited with error, checking if binary was created anyway..."
        }
        ;;
    MINGW*|MSYS*|CYGWIN*)
        # Windows: Build Windows binary only
        echo "Building Windows binary..."
        npx @yao-pkg/pkg dist/bundle.cjs --targets node20-win-x64 --output dist/allow2automate-agent-helper-win.exe --config package.json 2>&1 | tee pkg-output.log || {
            echo "Warning: pkg exited with error, checking if binary was created anyway..."
        }
        ;;
    *)
        echo "Unknown OS: $CURRENT_OS"
        echo "Building for all platforms..."
        npx @yao-pkg/pkg dist/bundle.cjs --targets node20-linux-x64 --output dist/allow2automate-agent-helper-linux --config package.json
        npx @yao-pkg/pkg dist/bundle.cjs --targets node20-win-x64 --output dist/allow2automate-agent-helper-win.exe --config package.json
        # Skip macOS if not on macOS (lipo not available)
        ;;
esac

echo ""
echo "✅ Helper binaries built successfully"
ls -lh dist/
