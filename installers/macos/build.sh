#!/bin/bash
set -e

echo "Building macOS PKG installer..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"

# Build the binary with pkg
echo "Building macOS binary..."
# Create dist directory first
mkdir -p dist

# Try to build - use --output to specify exact filename
npx pkg . --targets node18-macos-x64 --output dist/allow2automate-agent-macos 2>&1 | tee pkg-output.log || {
    echo "Warning: pkg exited with error, checking if binary was created anyway..."
}

# Create installer structure
BUILD_DIR="installers/macos/build"
DIST_DIR="installers/macos/dist"
PAYLOAD_DIR="$BUILD_DIR/payload"
SCRIPTS_DIR="$BUILD_DIR/scripts"

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$PAYLOAD_DIR/usr/local/bin" "$PAYLOAD_DIR/Library/LaunchDaemons" "$SCRIPTS_DIR" "$DIST_DIR"

# List what was actually built (for debugging)
echo "=== Checking dist directory ==="
ls -laR dist/ || echo "dist/ directory not found or empty"

# Try multiple possible binary names
BINARY=""
for pattern in "allow2automate-agent-macos" "allow2automate-agent" "@allow2-allow2automate-agent-macos" "@allow2-allow2automate-agent"; do
    if [ -f "dist/$pattern" ]; then
        BINARY="dist/$pattern"
        echo "Found binary: $BINARY"
        break
    fi
done

# If specific names didn't work, search for any executable
if [ -z "$BINARY" ]; then
    echo "Searching for any binary in dist/..."
    BINARY=$(find dist -type f -perm +111 2>/dev/null | head -n 1)
fi

if [ -z "$BINARY" ] || [ ! -f "$BINARY" ]; then
    echo "Error: No binary found in dist/"
    echo "Contents of dist:"
    ls -la dist/ || echo "dist/ does not exist"
    exit 1
fi

echo "Using binary: $BINARY"
cp "$BINARY" "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"
chmod +x "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"

# Create LaunchDaemon plist
cat > "$PAYLOAD_DIR/Library/LaunchDaemons/com.allow2.automate-agent.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.allow2.automate-agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/allow2automate-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/var/log/allow2automate-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/allow2automate-agent-error.log</string>
</dict>
</plist>
EOF

# Create postinstall script
cat > "$SCRIPTS_DIR/postinstall" << 'SCRIPT'
#!/bin/bash
launchctl load /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null || true
launchctl start com.allow2.automate-agent 2>/dev/null || true
echo "Allow2 Automate Agent installed successfully"
exit 0
SCRIPT
chmod +x "$SCRIPTS_DIR/postinstall"

# Create preinstall script
cat > "$SCRIPTS_DIR/preinstall" << 'SCRIPT'
#!/bin/bash
launchctl stop com.allow2.automate-agent 2>/dev/null || true
launchctl unload /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null || true
exit 0
SCRIPT
chmod +x "$SCRIPTS_DIR/preinstall"

# Build PKG
PKG_NAME="allow2automate-agent-${VERSION}.pkg"
pkgbuild \
    --root "$PAYLOAD_DIR" \
    --scripts "$SCRIPTS_DIR" \
    --identifier "com.allow2.automate-agent" \
    --version "$VERSION" \
    --install-location "/" \
    "$DIST_DIR/$PKG_NAME"

echo "✅ macOS PKG created: $DIST_DIR/$PKG_NAME"
ls -lh "$DIST_DIR/$PKG_NAME"
