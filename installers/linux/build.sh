#!/bin/bash
set -e

echo "Building Linux DEB and RPM installers..."

# Get version from environment variable (set by GitHub Actions from git tag)
# or fall back to package.json for local builds
if [ -z "$VERSION" ]; then
    VERSION=$(node -p "require('./package.json').version")
    echo "Version from package.json: $VERSION"
else
    echo "Version from git tag: $VERSION"
fi

# Build the binary with pkg
echo "Building Linux binary..."
mkdir -p dist

npx pkg . --targets node18-linux-x64 --output dist/allow2automate-agent-linux 2>&1 | tee pkg-output.log || {
    echo "Warning: pkg exited with error, checking if binary was created anyway..."
}

# Create installer structure
BUILD_DIR="installers/linux/build"
DIST_DIR="installers/linux/dist"

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR/usr/local/bin" "$BUILD_DIR/lib/systemd/system" "$DIST_DIR"

# List what was actually built (for debugging)
echo "=== Checking dist directory ==="
ls -laR dist/ || echo "dist/ directory not found or empty"

# Try multiple possible binary names
BINARY=""
for pattern in "allow2automate-agent-linux" "allow2automate-agent" "@allow2-allow2automate-agent-linux" "@allow2-allow2automate-agent"; do
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
cp "$BINARY" "$BUILD_DIR/usr/local/bin/allow2automate-agent"
chmod +x "$BUILD_DIR/usr/local/bin/allow2automate-agent"

# Create systemd service
cat > "$BUILD_DIR/lib/systemd/system/allow2automate-agent.service" << EOF
[Unit]
Description=Allow2 Automate Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/allow2automate-agent
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create postinstall script
cat > "installers/linux/postinst.sh" << 'SCRIPT'
#!/bin/bash
systemctl daemon-reload
systemctl enable allow2automate-agent.service
systemctl start allow2automate-agent.service
echo "✅ Allow2 Automate Agent installed and started"
exit 0
SCRIPT
chmod +x installers/linux/postinst.sh

# Create preremove script
cat > "installers/linux/prerm.sh" << 'SCRIPT'
#!/bin/bash
systemctl stop allow2automate-agent.service || true
systemctl disable allow2automate-agent.service || true
exit 0
SCRIPT
chmod +x installers/linux/prerm.sh

# Build DEB
echo "Building DEB package..."
fpm -s dir -t deb \
    -n allow2automate-agent \
    -v "$VERSION" \
    --description "Agent service for process monitoring and parental controls" \
    --url "https://github.com/Allow2/allow2automate-agent" \
    --maintainer "Allow2 <support@allow2.com>" \
    --license "MIT" \
    --architecture amd64 \
    --after-install installers/linux/postinst.sh \
    --before-remove installers/linux/prerm.sh \
    --deb-systemd "$BUILD_DIR/lib/systemd/system/allow2automate-agent.service" \
    --package "$DIST_DIR/allow2automate-agent_${VERSION}_amd64.deb" \
    -C "$BUILD_DIR" \
    .

# Build RPM
echo "Building RPM package..."
fpm -s dir -t rpm \
    -n allow2automate-agent \
    -v "$VERSION" \
    --description "Agent service for process monitoring and parental controls" \
    --url "https://github.com/Allow2/allow2automate-agent" \
    --maintainer "Allow2 <support@allow2.com>" \
    --license "MIT" \
    --architecture x86_64 \
    --after-install installers/linux/postinst.sh \
    --before-remove installers/linux/prerm.sh \
    --package "$DIST_DIR/allow2automate-agent-${VERSION}.x86_64.rpm" \
    -C "$BUILD_DIR" \
    .

echo "✅ Linux packages created:"
ls -lh "$DIST_DIR"/*.deb "$DIST_DIR"/*.rpm
