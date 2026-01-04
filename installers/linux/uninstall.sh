#!/bin/bash
#
# Allow2 Automate Agent - Linux Uninstaller
#
# This script removes the Allow2 Automate Agent from your Linux system.
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
echo "  - Systemd service"
echo "  - Binary at /usr/local/bin/allow2automate-agent"
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
echo "Stopping service..."
systemctl stop allow2automate-agent 2>/dev/null || echo "Service not running"

echo "Disabling service..."
systemctl disable allow2automate-agent 2>/dev/null || echo "Service not enabled"

echo "Removing files..."
rm -f /etc/systemd/system/allow2automate-agent.service
rm -f /usr/local/bin/allow2automate-agent
rm -f /var/log/allow2automate-agent.log
rm -f /var/log/allow2automate-agent-error.log

# Remove config directory if it exists
if [ -d "/etc/allow2automate" ]; then
    echo "Removing configuration directory..."
    rm -rf /etc/allow2automate
fi

echo "Reloading systemd..."
systemctl daemon-reload

echo ""
echo "✅ Allow2 Automate Agent has been successfully uninstalled."
echo ""
