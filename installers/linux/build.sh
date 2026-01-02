#!/bin/bash
set -e

echo "Building Linux DEB and RPM installers..."

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "Version: $VERSION"

# Build the binary with pkg
echo "Building Linux binary..."
npx pkg . --targets node18-linux-x64 --out-path dist --output dist/allow2automate-agent-linux

# Create installer structure
BUILD_DIR="installers/linux/build"
DIST_DIR="installers/linux/dist"

rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR/usr/local/bin" "$BUILD_DIR/lib/systemd/system" "$DIST_DIR"

# List what was actually built (for debugging)
echo "Built binaries:"
ls -la dist/

# Copy binary (find it regardless of exact name)
BINARY=$(find dist -name "*allow2automate-agent*" -type f | head -n 1)
if [ -z "$BINARY" ]; then
    echo "Error: No binary found in dist/"
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
