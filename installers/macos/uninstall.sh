#!/bin/bash
#
# Allow2 Automate Agent - macOS Uninstaller
#
# This script removes the Allow2 Automate Agent and Helper from your macOS system.
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
echo "  - LaunchDaemon service (main agent)"
echo "  - LaunchAgent (user helper)"
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

# Kill any running agent processes (shouldn't happen if service is used, but just in case)
echo "Stopping agent processes..."
if pkill -f "allow2automate-agent" 2>/dev/null; then
    echo "  Killed agent process(es)"
    track_removal "Agent processes" "true"
else
    echo "  No agent processes running"
fi

echo ""
echo "=== Unloading Services ==="

# Stop and unload main agent LaunchDaemon
echo "Stopping main agent service..."
if launchctl stop com.allow2.automate-agent 2>/dev/null; then
    echo "  Stopped LaunchDaemon"
fi

echo "Unloading LaunchDaemon..."
if launchctl unload /Library/LaunchDaemons/com.allow2.automate-agent.plist 2>/dev/null; then
    echo "  Unloaded LaunchDaemon"
    track_removal "LaunchDaemon unload" "true"
else
    echo "  LaunchDaemon not loaded or already unloaded"
fi

# Stop and unload helper LaunchAgent for all users
echo "Stopping helper for all users..."
for user_home in /Users/*; do
    username=$(basename "$user_home")
    if [ "$username" != "Shared" ] && [ -d "$user_home" ]; then
        # Try system-wide LaunchAgent
        sudo -u "$username" launchctl unload /Library/LaunchAgents/com.allow2.agent-helper.plist 2>/dev/null && \
            echo "  Unloaded helper for $username (system)" || true
        # Try user-specific LaunchAgent
        sudo -u "$username" launchctl unload "$user_home/Library/LaunchAgents/com.allow2.agent-helper.plist" 2>/dev/null && \
            echo "  Unloaded helper for $username (user)" || true
    fi
done

echo ""
echo "=== Removing Files ==="

# Remove LaunchDaemon plist
echo "Removing LaunchDaemon plist..."
if [ -f /Library/LaunchDaemons/com.allow2.automate-agent.plist ]; then
    if rm -f /Library/LaunchDaemons/com.allow2.automate-agent.plist; then
        echo "  Removed /Library/LaunchDaemons/com.allow2.automate-agent.plist"
        track_removal "LaunchDaemon plist" "true"
    else
        echo "  Failed to remove LaunchDaemon plist"
        track_removal "LaunchDaemon plist" "false"
    fi
else
    echo "  LaunchDaemon plist not found (already removed)"
fi

# Remove system-wide LaunchAgent plist
echo "Removing system LaunchAgent plist..."
if [ -f /Library/LaunchAgents/com.allow2.agent-helper.plist ]; then
    if rm -f /Library/LaunchAgents/com.allow2.agent-helper.plist; then
        echo "  Removed /Library/LaunchAgents/com.allow2.agent-helper.plist"
        track_removal "System LaunchAgent plist" "true"
    else
        echo "  Failed to remove system LaunchAgent plist"
        track_removal "System LaunchAgent plist" "false"
    fi
else
    echo "  System LaunchAgent plist not found (already removed)"
fi

# Remove user-specific LaunchAgent plists
echo "Removing user LaunchAgent plists..."
for user_home in /Users/*; do
    username=$(basename "$user_home")
    plist_path="$user_home/Library/LaunchAgents/com.allow2.agent-helper.plist"
    if [ -f "$plist_path" ]; then
        if rm -f "$plist_path"; then
            echo "  Removed $plist_path"
            track_removal "User LaunchAgent ($username)" "true"
        else
            echo "  Failed to remove $plist_path"
            track_removal "User LaunchAgent ($username)" "false"
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

# Remove config directories
echo "Removing configuration directories..."
for config_dir in \
    "$HOME/.allow2automate" \
    "/etc/allow2automate" \
    "/Library/Application Support/Allow2"; do
    if [ -d "$config_dir" ]; then
        if rm -rf "$config_dir"; then
            echo "  Removed $config_dir"
            track_removal "Config directory: $config_dir" "true"
        else
            echo "  Failed to remove $config_dir"
            track_removal "Config directory: $config_dir" "false"
        fi
    fi
done

# Remove user-specific config directories
for user_home in /Users/*; do
    username=$(basename "$user_home")
    config_dir="$user_home/.allow2automate"
    if [ -d "$config_dir" ]; then
        if rm -rf "$config_dir"; then
            echo "  Removed $config_dir"
        else
            echo "  Failed to remove $config_dir"
        fi
    fi
done

# Forget package receipt
echo "Forgetting package receipt..."
if pkgutil --pkgs 2>/dev/null | grep -q "com.allow2.automate-agent"; then
    if pkgutil --forget com.allow2.automate-agent 2>/dev/null; then
        echo "  Forgot package com.allow2.automate-agent"
        track_removal "Package receipt" "true"
    else
        echo "  Failed to forget package"
        track_removal "Package receipt" "false"
    fi
else
    echo "  Package not registered (already forgotten)"
fi

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

# Check for remaining files
[ -f /Library/LaunchDaemons/com.allow2.automate-agent.plist ] && REMAINING+=("/Library/LaunchDaemons/com.allow2.automate-agent.plist")
[ -f /Library/LaunchAgents/com.allow2.agent-helper.plist ] && REMAINING+=("/Library/LaunchAgents/com.allow2.agent-helper.plist")
[ -f /usr/local/bin/allow2automate-agent ] && REMAINING+=("/usr/local/bin/allow2automate-agent")
[ -f /usr/local/bin/allow2automate-agent-helper ] && REMAINING+=("/usr/local/bin/allow2automate-agent-helper")

# Check for remaining user LaunchAgents
for user_home in /Users/*; do
    plist_path="$user_home/Library/LaunchAgents/com.allow2.agent-helper.plist"
    [ -f "$plist_path" ] && REMAINING+=("$plist_path")
done

# Check if package is still registered
if pkgutil --pkgs 2>/dev/null | grep -q "com.allow2.automate-agent"; then
    REMAINING+=("Package receipt still registered")
fi

echo ""
echo "========================================"

if [ ${#REMAINING[@]} -eq 0 ]; then
    echo "SUCCESS: Allow2 Automate Agent completely uninstalled!"
    echo ""
    echo "Removed items:"
    for item in "${SUCCESSES[@]}"; do
        echo "  - $item"
    done
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
