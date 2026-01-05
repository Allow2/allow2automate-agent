#!/bin/bash
#
# Allow2 Automate Agent - macOS Uninstaller
#
# This script removes the Allow2 Automate Agent from your macOS system.
#

set -e

echo "Allow2 Automate Agent - Uninstaller"
echo "===================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo privileges."
    echo "Usage: sudo bash uninstall.sh"
    exit 1
fi

echo "This will remove:"
echo "  - LaunchDaemon service (main agent)"
echo "  - LaunchAgent (user helper)"
echo "  - Binaries at /usr/local/bin/"
echo "  - Configuration files"
echo "  - Log files"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo ""
echo "Stopping main agent service..."
launchctl stop com.allow2.automate-agent 2>/dev/null || echo "Service not running"

echo "Unloading LaunchDaemon..."
launchctl unload /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null || echo "LaunchDaemon not loaded"

echo "Stopping helper for all users..."
for user_home in /Users/*; do
    username=$(basename "$user_home")
    if [ "$username" != "Shared" ]; then
        sudo -u "$username" launchctl unload /Library/LaunchAgents/com.allow2.agent-helper.plist 2>/dev/null || true
    fi
done

echo "Removing files..."
rm -f /Library/LaunchDaemons/com.allow2.automate-agent.plist
rm -f /Library/LaunchAgents/com.allow2.agent-helper.plist
rm -f /usr/local/bin/allow2automate-agent
rm -f /usr/local/bin/allow2automate-agent-helper
rm -f /var/log/allow2automate-agent.log
rm -f /var/log/allow2automate-agent-error.log
rm -f /tmp/allow2-agent-helper.log
rm -f /tmp/allow2-agent-helper-error.log

# Remove config directory if it exists
if [ -d "$HOME/.allow2automate" ]; then
    echo "Removing configuration directory..."
    rm -rf "$HOME/.allow2automate"
fi

echo "Forgetting package..."
pkgutil --forget com.allow2.automate-agent 2>/dev/null || echo "Package not registered"

echo ""
echo "✅ Allow2 Automate Agent has been successfully uninstalled."
echo ""
