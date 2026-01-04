#!/bin/bash
set -e

echo "Building macOS PKG installer..."

# Get version from environment variable (set by GitHub Actions from git tag)
# or fall back to package.json for local builds
if [ -z "$VERSION" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "Version from package.json: $VERSION"
else
    echo "Version from git tag: $VERSION"
fi

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

# Sign the binary if certificate is available (done in GitHub Actions)
# This must be done BEFORE creating the PKG
if [ -n "$APPLE_DEVELOPER_ID" ]; then
    # Safely redact identity (handle short strings)
    ID_LENGTH=${#APPLE_DEVELOPER_ID}
    if [ "$ID_LENGTH" -gt 8 ]; then
        REDACTED_ID="${APPLE_DEVELOPER_ID:0:8}...${APPLE_DEVELOPER_ID: -4}"
    else
        REDACTED_ID="***"
    fi
    echo "Signing binary with identity: $REDACTED_ID"

    # Determine keychain path (modern macOS uses -db suffix)
    KEYCHAIN_NAME="temp.keychain"
    KEYCHAIN_PATH="$HOME/Library/Keychains/temp.keychain-db"

    # Debug: Check if temp keychain exists and list available identities
    if [ -f "$KEYCHAIN_PATH" ]; then
        echo "=== Keychain Debug Info ==="
        echo "Temp keychain exists at: $KEYCHAIN_PATH"

        # Unlock the keychain (use short name without -db suffix)
        echo "Unlocking keychain..."
        security unlock-keychain -p actions "$KEYCHAIN_NAME"

        # CRITICAL: Re-add to search list in case it was removed
        echo "Re-adding keychain to search list..."
        security list-keychains -d user -s "$KEYCHAIN_PATH" $(security list-keychains -d user | sed 's/"//g' | grep -v temp.keychain)

        # Set as default keychain
        echo "Setting default keychain..."
        security default-keychain -s "$KEYCHAIN_NAME"

        # Verify keychain search list (GitHub-safe - just paths)
        echo "Current keychain search list:"
        security list-keychains -d user

        # List all signing identities to verify certificate is accessible
        echo "=== Checking available identities ==="

        echo "Identities in temp.keychain:"
        TEMP_COUNT=$(security find-identity -v -p codesigning "$KEYCHAIN_NAME" 2>&1 | grep -c "valid identities found" || echo "0")
        security find-identity -v -p codesigning "$KEYCHAIN_NAME" 2>&1 | sed 's/\(.*\)./\1-/'

        echo "All available identities (all keychains):"
        ALL_COUNT=$(security find-identity -v -p codesigning 2>&1 | grep -c "valid identities found" || echo "0")
        security find-identity -v -p codesigning 2>&1 | sed 's/\(.*\)./\1-/'

        echo "Identity count check: temp=$TEMP_COUNT, all=$ALL_COUNT"
    else
        echo "❌ ERROR: Temp keychain not found at $KEYCHAIN_PATH"
        echo "Searching for keychain files..."
        ls -la "$HOME/Library/Keychains/" | grep temp || echo "No temp keychain found"

        echo "Available keychains:"
        security list-keychains -d user

        echo "Will attempt to sign with default keychain..."
    fi

    # Perform codesigning - explicitly use temp keychain
    echo "Attempting to sign binary..."
    codesign --force --options runtime \
        --sign "$APPLE_DEVELOPER_ID" \
        --keychain "$KEYCHAIN_PATH" \
        --timestamp \
        "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"

    # Verify the signature
    echo "✅ Verifying signature..."
    codesign --verify --verbose=4 "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"
    codesign --display --verbose=4 "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent" | sed 's/\(.*\)./\1-/'
else
    echo "⚠️  APPLE_DEVELOPER_ID not set - binary will not be signed"
fi

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
