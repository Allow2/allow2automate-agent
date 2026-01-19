#!/bin/bash
#
# Allow2 Automate Agent - Linux Uninstaller
#
# This script removes the Allow2 Automate Agent and Helper from your Linux system.
# It verifies each removal step and reports what was cleaned up or what failed.
#

echo "Allow2 Automate Agent - Uninstaller"
echo "===================================="
echo ""

# Track failures
FAILURES=()
SUCCESSES=()

# Helper function to track results
track_removal() {
    local item="$1"
    local success="$2"
    if [ "$success" = "true" ]; then
        SUCCESSES+=("$item")
    else
        FAILURES+=("$item")
    fi
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo privileges."
    echo "Usage: sudo bash uninstall.sh"
    exit 1
fi

echo "This will remove:"
echo "  - Systemd service (main agent)"
echo "  - User helper and autostart"
echo "  - Binaries at /usr/local/bin/"
echo "  - Configuration files"
echo "  - Log files"
echo "  - Running processes"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

echo ""
echo "=== Stopping Processes ==="

# Kill any running helper processes
echo "Stopping helper processes..."
if pkill -f "allow2automate-agent-helper" 2>/dev/null; then
    echo "  Killed helper process(es)"
    track_removal "Helper processes" "true"
else
    echo "  No helper processes running"
fi

# The main agent should be stopped via systemd, but kill any stray processes
echo "Stopping any stray agent processes..."
if pkill -f "allow2automate-agent" 2>/dev/null; then
    echo "  Killed agent process(es)"
    track_removal "Agent processes" "true"
else
    echo "  No stray agent processes running"
fi

echo ""
echo "=== Stopping Services ==="

# Stop and disable systemd service
echo "Stopping main agent service..."
if systemctl is-active --quiet allow2automate-agent 2>/dev/null; then
    if systemctl stop allow2automate-agent 2>/dev/null; then
        echo "  Stopped systemd service"
        track_removal "Systemd service stop" "true"
    else
        echo "  Failed to stop systemd service"
        track_removal "Systemd service stop" "false"
    fi
else
    echo "  Service not running"
fi

echo "Disabling service..."
if systemctl is-enabled --quiet allow2automate-agent 2>/dev/null; then
    if systemctl disable allow2automate-agent 2>/dev/null; then
        echo "  Disabled systemd service"
        track_removal "Systemd service disable" "true"
    else
        echo "  Failed to disable systemd service"
        track_removal "Systemd service disable" "false"
    fi
else
    echo "  Service not enabled"
fi

echo ""
echo "=== Removing Files ==="

# Remove systemd service files
echo "Removing systemd service files..."
for service_file in \
    /etc/systemd/system/allow2automate-agent.service \
    /lib/systemd/system/allow2automate-agent.service \
    /usr/lib/systemd/system/allow2automate-agent.service; do
    if [ -f "$service_file" ]; then
        if rm -f "$service_file"; then
            echo "  Removed $service_file"
            track_removal "Systemd service file" "true"
        else
            echo "  Failed to remove $service_file"
            track_removal "Systemd service file" "false"
        fi
    fi
done

# Remove main agent binary
echo "Removing main agent binary..."
if [ -f /usr/local/bin/allow2automate-agent ]; then
    if rm -f /usr/local/bin/allow2automate-agent; then
        echo "  Removed /usr/local/bin/allow2automate-agent"
        track_removal "Main agent binary" "true"
    else
        echo "  Failed to remove main agent binary"
        track_removal "Main agent binary" "false"
    fi
else
    echo "  Main agent binary not found (already removed)"
fi

# Remove helper binary
echo "Removing helper binary..."
if [ -f /usr/local/bin/allow2automate-agent-helper ]; then
    if rm -f /usr/local/bin/allow2automate-agent-helper; then
        echo "  Removed /usr/local/bin/allow2automate-agent-helper"
        track_removal "Helper binary" "true"
    else
        echo "  Failed to remove helper binary"
        track_removal "Helper binary" "false"
    fi
else
    echo "  Helper binary not found (already removed)"
fi

# Remove autostart desktop entry (system-wide)
echo "Removing autostart entries..."
if [ -f /etc/xdg/autostart/allow2-agent-helper.desktop ]; then
    if rm -f /etc/xdg/autostart/allow2-agent-helper.desktop; then
        echo "  Removed /etc/xdg/autostart/allow2-agent-helper.desktop"
        track_removal "System autostart entry" "true"
    else
        echo "  Failed to remove system autostart entry"
        track_removal "System autostart entry" "false"
    fi
else
    echo "  System autostart entry not found (already removed)"
fi

# Remove user-specific autostart entries
echo "Removing user autostart entries..."
for user_home in /home/*; do
    username=$(basename "$user_home")
    autostart_file="$user_home/.config/autostart/allow2-agent-helper.desktop"
    if [ -f "$autostart_file" ]; then
        if rm -f "$autostart_file"; then
            echo "  Removed $autostart_file"
            track_removal "User autostart ($username)" "true"
        else
            echo "  Failed to remove $autostart_file"
            track_removal "User autostart ($username)" "false"
        fi
    fi
done

# Remove log files
echo "Removing log files..."
for logfile in \
    /var/log/allow2automate-agent.log \
    /var/log/allow2automate-agent-error.log \
    /tmp/allow2-agent-helper.log \
    /tmp/allow2-agent-helper-error.log \
    /tmp/allow2-helper-startup.flag; do
    if [ -f "$logfile" ]; then
        rm -f "$logfile" && echo "  Removed $logfile" || echo "  Failed to remove $logfile"
    fi
done

# Also check journald logs info
echo "  Note: Systemd journal logs can be cleared with: sudo journalctl --vacuum-time=1s --unit=allow2automate-agent"

# Remove config directories
echo "Removing configuration directories..."
if [ -d "/etc/allow2automate" ]; then
    if rm -rf /etc/allow2automate; then
        echo "  Removed /etc/allow2automate"
        track_removal "System config directory" "true"
    else
        echo "  Failed to remove /etc/allow2automate"
        track_removal "System config directory" "false"
    fi
else
    echo "  System config directory not found (already removed)"
fi

# Remove user-specific config directories
for user_home in /home/*; do
    username=$(basename "$user_home")
    config_dir="$user_home/.allow2automate"
    if [ -d "$config_dir" ]; then
        if rm -rf "$config_dir"; then
            echo "  Removed $config_dir"
            track_removal "User config ($username)" "true"
        else
            echo "  Failed to remove $config_dir"
            track_removal "User config ($username)" "false"
        fi
    fi
done

# Reload systemd
echo "Reloading systemd daemon..."
systemctl daemon-reload 2>/dev/null && echo "  Systemd daemon reloaded" || echo "  Failed to reload systemd daemon"

echo ""
echo "=== Verification ==="

# Verify everything is cleaned up
REMAINING=()

# Check for remaining processes
if pgrep -f "allow2automate-agent-helper" >/dev/null 2>&1; then
    REMAINING+=("Helper process still running")
fi
if pgrep -f "allow2automate-agent" >/dev/null 2>&1; then
    REMAINING+=("Agent process still running")
fi

# Check for remaining service
if systemctl list-unit-files 2>/dev/null | grep -q "allow2automate-agent"; then
    REMAINING+=("Systemd service still registered")
fi

# Check for remaining files
[ -f /etc/systemd/system/allow2automate-agent.service ] && REMAINING+=("/etc/systemd/system/allow2automate-agent.service")
[ -f /lib/systemd/system/allow2automate-agent.service ] && REMAINING+=("/lib/systemd/system/allow2automate-agent.service")
[ -f /usr/local/bin/allow2automate-agent ] && REMAINING+=("/usr/local/bin/allow2automate-agent")
[ -f /usr/local/bin/allow2automate-agent-helper ] && REMAINING+=("/usr/local/bin/allow2automate-agent-helper")
[ -f /etc/xdg/autostart/allow2-agent-helper.desktop ] && REMAINING+=("/etc/xdg/autostart/allow2-agent-helper.desktop")
[ -d /etc/allow2automate ] && REMAINING+=("/etc/allow2automate")

# Check for remaining user files
for user_home in /home/*; do
    username=$(basename "$user_home")
    [ -f "$user_home/.config/autostart/allow2-agent-helper.desktop" ] && REMAINING+=("$user_home/.config/autostart/allow2-agent-helper.desktop")
    [ -d "$user_home/.allow2automate" ] && REMAINING+=("$user_home/.allow2automate")
done

echo ""
echo "========================================"

if [ ${#REMAINING[@]} -eq 0 ]; then
    echo "SUCCESS: Allow2 Automate Agent completely uninstalled!"
    echo ""
    echo "Removed items:"
    for item in "${SUCCESSES[@]}"; do
        echo "  - $item"
    done
    echo ""
    echo "Note: Helper processes for logged-in users will stop after logout/restart."
else
    echo "WARNING: Some items could not be removed:"
    echo ""
    for item in "${REMAINING[@]}"; do
        echo "  - $item"
    done
    echo ""
    echo "You may need to manually remove these items or restart and try again."
fi

echo ""
echo "========================================"
echo ""
