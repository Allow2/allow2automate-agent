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

# Build the binary with pkg - create universal binary for Intel + Apple Silicon
echo "Building macOS binaries (universal)..."
# Create dist directory first
mkdir -p dist

# Build for Intel (x64)
echo "Building for Intel (x64)..."
npx @yao-pkg/pkg . --targets node20-macos-x64 --output dist/allow2automate-agent-macos-x64 2>&1 | tee pkg-output-x64.log || {
    echo "Warning: pkg exited with error for x64, checking if binary was created anyway..."
}

# Build for Apple Silicon (arm64)
echo "Building for Apple Silicon (arm64)..."
npx @yao-pkg/pkg . --targets node20-macos-arm64 --output dist/allow2automate-agent-macos-arm64 2>&1 | tee pkg-output-arm64.log || {
    echo "Warning: pkg exited with error for arm64, checking if binary was created anyway..."
}

# Create universal binary using lipo (if both builds succeeded)
if [ -f "dist/allow2automate-agent-macos-x64" ] && [ -f "dist/allow2automate-agent-macos-arm64" ]; then
    echo "Creating universal binary..."
    lipo -create -output dist/allow2automate-agent-macos \
        dist/allow2automate-agent-macos-x64 \
        dist/allow2automate-agent-macos-arm64
    echo "Universal binary created successfully"
    # Verify
    file dist/allow2automate-agent-macos
elif [ -f "dist/allow2automate-agent-macos-arm64" ]; then
    echo "Only arm64 build succeeded, using that..."
    cp dist/allow2automate-agent-macos-arm64 dist/allow2automate-agent-macos
elif [ -f "dist/allow2automate-agent-macos-x64" ]; then
    echo "Only x64 build succeeded, using that..."
    cp dist/allow2automate-agent-macos-x64 dist/allow2automate-agent-macos
fi

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
        TEMP_OUTPUT=$(security find-identity -v -p codesigning "$KEYCHAIN_NAME" 2>&1)
        echo "$TEMP_OUTPUT" | sed 's/\("[^"]*"\)/"***"/g'  # Redact identity names
        TEMP_COUNT=$(echo "$TEMP_OUTPUT" | grep -E "^\s+[0-9]+\)" | wc -l | tr -d ' ')

        echo "All available identities (all keychains):"
        ALL_OUTPUT=$(security find-identity -v -p codesigning 2>&1)
        echo "$ALL_OUTPUT" | sed 's/\("[^"]*"\)/"***"/g'  # Redact identity names
        ALL_COUNT=$(echo "$ALL_OUTPUT" | grep -E "^\s+[0-9]+\)" | wc -l | tr -d ' ')

        echo "Identity count check: temp=$TEMP_COUNT, all=$ALL_COUNT"

        # If no identities found, show detailed error
        if [ "$TEMP_COUNT" -eq 0 ]; then
            echo "❌ ERROR: No signing identities found in temp.keychain!"
            echo "This means the certificate import failed or the certificate doesn't contain a code signing identity."
            echo "Checking certificate import details..."
            security find-certificate -a -p "$KEYCHAIN_NAME" | openssl x509 -noout -subject -ext keyUsage -ext extendedKeyUsage 2>/dev/null || echo "Could not read certificate details"
            exit 1
        fi

        # Extract APPLICATION identity hash for codesigning binaries
        APP_IDENTITY_HASH=$(echo "$TEMP_OUTPUT" | grep -E "^\s+[0-9]+\)" | head -1 | awk '{print $2}')
        echo "Application identity hash: ${APP_IDENTITY_HASH:0:8}...${APP_IDENTITY_HASH: -4}"

        # Extract INSTALLER identity hash for signing PKG
        # Get all identities and filter for "Developer ID Installer"
        echo "Searching for Developer ID Installer identity..."
        ALL_IDENTITIES=$(security find-identity -v "$KEYCHAIN_NAME" 2>&1)
        INSTALLER_IDENTITY_HASH=$(echo "$ALL_IDENTITIES" | grep "Developer ID Installer" | head -1 | awk '{print $2}')

        if [ -n "$INSTALLER_IDENTITY_HASH" ]; then
            echo "Installer identity hash: ${INSTALLER_IDENTITY_HASH:0:8}...${INSTALLER_IDENTITY_HASH: -4}"
        else
            echo "⚠️  WARNING: No Developer ID Installer identity found"
            echo "PKG signing will not be possible"
        fi
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

    # Use the APPLICATION identity hash for codesigning binaries
    if [ -n "$APP_IDENTITY_HASH" ]; then
        APP_SIGN_IDENTITY="$APP_IDENTITY_HASH"
        echo "Using application identity hash: ${APP_IDENTITY_HASH:0:8}...${APP_IDENTITY_HASH: -4}"
    else
        APP_SIGN_IDENTITY="$APPLE_DEVELOPER_ID"
        echo "Using APPLE_DEVELOPER_ID: $REDACTED_ID"
    fi

    # Entitlements file for Node.js pkg binaries (enables JIT, unsigned memory, etc.)
    ENTITLEMENTS_FILE="installers/macos/entitlements.plist"
    if [ -f "$ENTITLEMENTS_FILE" ]; then
        echo "Using entitlements file: $ENTITLEMENTS_FILE"
        ENTITLEMENTS_FLAG="--entitlements $ENTITLEMENTS_FILE"
    else
        echo "⚠️  Warning: Entitlements file not found at $ENTITLEMENTS_FILE"
        ENTITLEMENTS_FLAG=""
    fi

    codesign --force --options runtime \
        --sign "$APP_SIGN_IDENTITY" \
        --keychain "$KEYCHAIN_PATH" \
        --timestamp \
        $ENTITLEMENTS_FLAG \
        "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"

    # Verify the signature
    echo "✅ Verifying signature..."
    codesign --verify --verbose=4 "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent"
    codesign --display --verbose=4 "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent" | sed 's/\(.*\)./\1-/'
else
    echo "⚠️  APPLE_DEVELOPER_ID not set - binary will not be signed"
fi

# Build helper application
echo "Building helper application..."
cd helper
bash build.sh
cd ..

# Copy helper binary to payload
echo "Including helper binary in package..."
mkdir -p "$PAYLOAD_DIR/usr/local/bin"
cp helper/dist/allow2automate-agent-helper-macos "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent-helper"
chmod +x "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent-helper"

# Copy helper LaunchAgent plist
mkdir -p "$PAYLOAD_DIR/Library/LaunchAgents"
cp helper/autostart/macos/com.allow2.agent-helper.plist "$PAYLOAD_DIR/Library/LaunchAgents/"

# Sign helper binary if certificate available
if [ -n "$APPLE_DEVELOPER_ID" ] && [ -n "$APP_IDENTITY_HASH" ]; then
    echo "Signing helper binary..."
    codesign --force --options runtime \
        --sign "$APP_SIGN_IDENTITY" \
        --keychain "$KEYCHAIN_PATH" \
        --timestamp \
        $ENTITLEMENTS_FLAG \
        "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent-helper"

    echo "✅ Verifying helper signature..."
    codesign --verify --verbose=4 "$PAYLOAD_DIR/usr/local/bin/allow2automate-agent-helper"
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
set -e

CONFIG_DEST="/Library/Application Support/Allow2/agent/config.json"
CONFIG_DIR="$(dirname "$CONFIG_DEST")"
CONFIG_SRC="/tmp/allow2automate-agent-config.json"

# Create config directory with proper permissions
mkdir -p "$CONFIG_DIR"
chmod 755 "$CONFIG_DIR"

# Copy validated config from temp location (placed there by distribution.xml JavaScript)
if [ -f "$CONFIG_SRC" ]; then
    echo "Installing configuration file..."
    cp "$CONFIG_SRC" "$CONFIG_DEST"
    chmod 600 "$CONFIG_DEST"
    chown root:wheel "$CONFIG_DEST"
    echo "✅ Configuration installed to: $CONFIG_DEST"

    # Clean up temp file
    rm -f "$CONFIG_SRC"
else
    echo "⚠️  Warning: Validated config not found at: $CONFIG_SRC"
    echo "   Installation may not be properly configured"
fi

# Start main agent service (system-wide)
echo "Starting Allow2 Automate Agent service..."
launchctl load /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null || true
launchctl start com.allow2.automate-agent 2>/dev/null || true

# Start helper for current user
CURRENT_USER=$(stat -f%Su /dev/console)
if [ -n "$CURRENT_USER" ] && [ "$CURRENT_USER" != "root" ]; then
    echo "Starting helper application for user: $CURRENT_USER"
    sudo -u "$CURRENT_USER" launchctl load /Library/LaunchAgents/com.allow2.agent-helper.plist 2>/dev/null || true
fi

echo ""
echo "✅ Allow2 Automate Agent installed successfully"
echo ""
echo "The agent is now running and will:"
echo "  • Connect to the parent server specified in configuration"
echo "  • Start automatically on system boot"
echo "  • Show status in menu bar (helper app)"
echo ""
echo "Configuration: $CONFIG_DEST"
echo "Logs: /var/log/allow2automate-agent.log"
echo ""

exit 0
SCRIPT
chmod +x "$SCRIPTS_DIR/postinstall"

# Create preinstall script
cat > "$SCRIPTS_DIR/preinstall" << 'SCRIPT'
#!/bin/bash
set -e

CONFIG_FILENAME="allow2automate-agent-config.json"
# Use /tmp for config - distribution.xml JavaScript copies it here
# /tmp is accessible by preinstall (unlike /var/tmp which can have issues)
TEMP_CONFIG="/tmp/$CONFIG_FILENAME"

echo "Allow2 Automate Agent - Pre-installation"
echo "========================================="

# Stop existing services first
echo "Stopping any existing services..."
launchctl stop com.allow2.automate-agent 2>/dev/null || true
launchctl unload /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null || true

# Stop helper for all users
for user_home in /Users/*; do
    username=$(basename "$user_home")
    if [ "$username" != "Shared" ]; then
        sudo -u "$username" launchctl unload /Library/LaunchAgents/com.allow2.agent-helper.plist 2>/dev/null || true
    fi
done

# The distribution.xml JavaScript should have already copied the config to /tmp
# This runs AFTER installation_check(), so config should be ready

echo "Looking for configuration file..."

# Check if config exists in /tmp (placed there by distribution.xml JavaScript)
if [ -f "$TEMP_CONFIG" ]; then
    echo "✅ Found config at: $TEMP_CONFIG"
else
    # Config wasn't found by distribution.xml - this shouldn't happen normally
    # but let's try some fallback locations anyway
    echo "⚠️  Config not found at expected location: $TEMP_CONFIG"
    echo "Attempting fallback search..."

    FOUND=""

    # Check mounted DMG volumes
    for vol in /Volumes/*; do
        if [ -d "$vol" ] && [ -f "$vol/$CONFIG_FILENAME" ]; then
            echo "Found in volume: $vol"
            if cp "$vol/$CONFIG_FILENAME" "$TEMP_CONFIG" 2>/dev/null; then
                FOUND="$vol/$CONFIG_FILENAME"
                break
            fi
        fi
    done

    if [ -z "$FOUND" ]; then
        echo ""
        echo "❌ ERROR: Configuration file not found!"
        echo ""
        echo "The distribution.xml JavaScript should have prepared the config,"
        echo "but it wasn't found. This may indicate a problem with the"
        echo "installation process."
        echo ""
        echo "Please ensure the config file ($CONFIG_FILENAME) is:"
        echo "  1. In the same folder as the installer (if using DMG)"
        echo "  2. Or copied to /tmp/ manually"
        echo ""
        exit 1
    fi
fi

# Validate JSON structure
echo "Validating configuration file..."
echo "File preview: $(head -c 100 "$TEMP_CONFIG" 2>/dev/null || echo '[cannot preview]')"

# Validate JSON and required fields using python
VALIDATION=$(python3 - "$TEMP_CONFIG" << 'PYEOF'
import json
import sys

config_path = sys.argv[1]
print(f"Reading config from: {config_path}", file=sys.stderr)

try:
    with open(config_path, 'r', encoding='utf-8') as f:
        content = f.read()

    print(f"File size: {len(content)} bytes", file=sys.stderr)

    try:
        config = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}")
        sys.exit(1)

    required = ['host', 'port', 'enableMDNS', 'host_uuid', 'public_key']
    missing = [f for f in required if f not in config]

    if missing:
        print(f"Missing fields: {', '.join(missing)}")
        sys.exit(1)

    if not isinstance(config['host'], str) or not config['host']:
        print("'host' must be a non-empty string")
        sys.exit(1)

    if not isinstance(config['port'], int) or config['port'] < 1 or config['port'] > 65535:
        print("'port' must be a number between 1 and 65535")
        sys.exit(1)

    if not isinstance(config['enableMDNS'], bool):
        print("'enableMDNS' must be a boolean")
        sys.exit(1)

    if not isinstance(config['host_uuid'], str) or not config['host_uuid']:
        print("'host_uuid' must be a non-empty string")
        sys.exit(1)

    if not isinstance(config['public_key'], str) or not config['public_key']:
        print("'public_key' must be a non-empty string")
        sys.exit(1)

    if '-----BEGIN PUBLIC KEY-----' not in config['public_key']:
        print("'public_key' must be a valid PEM-encoded public key")
        sys.exit(1)

    print("OK")
    sys.exit(0)

except FileNotFoundError:
    print(f"File not found: {config_path}")
    sys.exit(1)
except PermissionError:
    print(f"Permission denied: {config_path}")
    sys.exit(1)
except Exception as e:
    print(f"Validation error: {type(e).__name__}: {e}")
    sys.exit(1)
PYEOF
)

if [ "$VALIDATION" != "OK" ]; then
    echo "❌ ERROR: Invalid configuration file"
    echo "   $VALIDATION"
    exit 1
fi

echo "✅ Configuration validated successfully"
echo "✅ Pre-installation complete"
exit 0
SCRIPT
chmod +x "$SCRIPTS_DIR/preinstall"

# Create resources directory for distribution XML
RESOURCES_DIR="$BUILD_DIR/resources"
mkdir -p "$RESOURCES_DIR"

# Copy HTML resources
cp installers/macos/welcome.html "$RESOURCES_DIR/"
cp installers/macos/readme.html "$RESOURCES_DIR/"

# First, build component package (the actual payload)
COMPONENT_PKG="$BUILD_DIR/allow2automate-agent-component.pkg"
pkgbuild \
    --root "$PAYLOAD_DIR" \
    --scripts "$SCRIPTS_DIR" \
    --identifier "com.allow2.automate-agent" \
    --version "$VERSION" \
    --install-location "/" \
    "$COMPONENT_PKG"

# Then, build product archive with distribution XML
PKG_NAME="allow2automate-agent-darwin-universal-v${VERSION}.pkg"
productbuild \
    --distribution "installers/macos/distribution.xml" \
    --resources "$RESOURCES_DIR" \
    --package-path "$BUILD_DIR" \
    --version "$VERSION" \
    "$DIST_DIR/$PKG_NAME"

# Sign the PKG if INSTALLER certificate available
if [ -n "$APPLE_DEVELOPER_ID" ] && [ -n "$INSTALLER_IDENTITY_HASH" ]; then
    echo "Signing product package with Developer ID Installer certificate..."
    echo "Using installer identity: ${INSTALLER_IDENTITY_HASH:0:8}...${INSTALLER_IDENTITY_HASH: -4}"
    productsign --sign "$INSTALLER_IDENTITY_HASH" \
        --keychain "$KEYCHAIN_PATH" \
        "$DIST_DIR/$PKG_NAME" \
        "$DIST_DIR/${PKG_NAME%.pkg}-signed.pkg"
    mv "$DIST_DIR/${PKG_NAME%.pkg}-signed.pkg" "$DIST_DIR/$PKG_NAME"

    echo "✅ Verifying package signature..."
    pkgutil --check-signature "$DIST_DIR/$PKG_NAME"
elif [ -n "$APPLE_DEVELOPER_ID" ]; then
    echo "⚠️  WARNING: APPLE_DEVELOPER_ID is set but no Installer identity found"
    echo "PKG will NOT be signed - only the binaries inside are signed"
    echo "For a fully signed PKG, ensure APPLE_INSTALLER_CERT_BASE64 secret contains"
    echo "a valid 'Developer ID Installer' certificate"
fi

echo "✅ macOS PKG created: $DIST_DIR/$PKG_NAME"
ls -lh "$DIST_DIR/$PKG_NAME"

echo ""
echo "============================================================"
echo "                    BUILD COMPLETE"
echo "============================================================"
echo ""
echo "Artifact created: $DIST_DIR/$PKG_NAME"
echo ""
echo "NOTE: The main Allow2 Automate app will create a DMG bundle"
echo "containing this PKG along with the user's config file."
echo "This PKG is uploaded to GitHub Releases for the main app to download."
echo ""
