#!/bin/bash
#
# Allow2 Automate Agent - macOS Diagnostic Script
#
# This script checks the status of all Allow2 Automate Agent components on macOS:
# - LaunchDaemon status
# - Running processes
# - Configuration file
# - Log files
# - Network connectivity
# - Binary architecture (important for Apple Silicon vs Intel)
# - System requirements
#
# Usage: sudo ./diagnose-macos.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration paths
SERVICE_LABEL="com.allow2.automate-agent"
HELPER_LABEL="com.allow2.automate-agent-helper"
INSTALL_DIR="/usr/local/share/allow2automate-agent"
DATA_DIR="/Library/Application Support/Allow2/agent"
CONFIG_FILE="${DATA_DIR}/config.json"
LOG_DIR="/Library/Logs/Allow2/agent"
MAIN_LOG="${LOG_DIR}/agent.log"
ERROR_LOG="${LOG_DIR}/error.log"
AGENT_BIN="${INSTALL_DIR}/allow2automate-agent"
HELPER_BIN="${INSTALL_DIR}/allow2automate-agent-helper"
PLIST_FILE="/Library/LaunchDaemons/${SERVICE_LABEL}.plist"
HELPER_PLIST="/Library/LaunchAgents/${HELPER_LABEL}.plist"

# Track issues
declare -a ISSUES

print_header() {
    echo ""
    echo -e "${MAGENTA}============================================================${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}============================================================${NC}"
}

print_status() {
    local label="$1"
    local value="$2"
    local status="$3"  # success, warning, error, info

    local color=""
    local icon=""
    case "$status" in
        success) color="${GREEN}"; icon="[OK]" ;;
        warning) color="${YELLOW}"; icon="[!]" ;;
        error)   color="${RED}"; icon="[X]" ;;
        *)       color="${CYAN}"; icon="[i]" ;;
    esac

    echo -e "  ${color}${icon}${NC} ${label}: ${color}${value}${NC}"
}

print_subitem() {
    local color="${2:-${NC}}"
    echo -e "      ${color}$1${NC}"
}

# Check if running as root
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo -e "${YELLOW}WARNING: Not running as root. Some checks may be limited.${NC}"
        echo -e "${YELLOW}Run with: sudo $0${NC}"
        echo ""
    fi
}

echo ""
echo -e "${MAGENTA}Allow2 Automate Agent - macOS Diagnostics${NC}"
echo -e "${MAGENTA}===========================================${NC}"
echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Hostname:  $(hostname)"
echo "User:      $(whoami)"

check_root

# ============================================================================
# 1. SYSTEM INFO & ARCHITECTURE
# ============================================================================
print_header "1. System Information & Architecture"

# Get macOS version
MACOS_VERSION=$(sw_vers -productVersion)
print_status "macOS Version" "$MACOS_VERSION" "info"

# Get architecture
ARCH=$(uname -m)
print_status "Architecture" "$ARCH" "info"

# Check if running on Apple Silicon
if [ "$ARCH" = "arm64" ]; then
    print_status "CPU Type" "Apple Silicon (arm64)" "info"
    # Check Rosetta
    if /usr/bin/pgrep -q oahd; then
        print_status "Rosetta 2" "Running" "info"
    else
        print_status "Rosetta 2" "Not active" "info"
    fi
else
    print_status "CPU Type" "Intel (x86_64)" "info"
fi

# ============================================================================
# 2. SERVICE STATUS (LaunchDaemon)
# ============================================================================
print_header "2. Service Status (LaunchDaemon)"

if [ -f "$PLIST_FILE" ]; then
    print_status "Plist File" "Found" "success"
    print_subitem "$PLIST_FILE"

    # Check if loaded
    if launchctl list | grep -q "$SERVICE_LABEL"; then
        print_status "Service" "Loaded" "success"

        # Get PID
        PID=$(launchctl list | grep "$SERVICE_LABEL" | awk '{print $1}')
        if [ "$PID" != "-" ] && [ -n "$PID" ]; then
            print_status "Process ID" "$PID" "success"
        else
            print_status "Process ID" "Not running (service loaded but process not started)" "error"
            ISSUES+=("Service is loaded but process is not running")
        fi

        # Check exit status
        EXIT_STATUS=$(launchctl list | grep "$SERVICE_LABEL" | awk '{print $2}')
        if [ "$EXIT_STATUS" != "0" ] && [ "$EXIT_STATUS" != "-" ]; then
            print_status "Last Exit Status" "$EXIT_STATUS (error)" "error"
            ISSUES+=("Service exited with error code $EXIT_STATUS")
        fi
    else
        print_status "Service" "NOT LOADED" "error"
        ISSUES+=("Service is not loaded")
    fi
else
    print_status "Plist File" "NOT FOUND" "error"
    print_subitem "Expected: $PLIST_FILE" "${RED}"
    ISSUES+=("LaunchDaemon plist not found - agent not installed")
fi

# Helper status
if [ -f "$HELPER_PLIST" ]; then
    print_status "Helper Plist" "Found" "success"
else
    print_status "Helper Plist" "Not installed (optional)" "info"
fi

# ============================================================================
# 3. PROCESS STATUS
# ============================================================================
print_header "3. Running Processes"

AGENT_PROCS=$(pgrep -f "allow2automate-agent" 2>/dev/null || true)
HELPER_PROCS=$(pgrep -f "allow2automate-agent-helper" 2>/dev/null || true)

if [ -n "$AGENT_PROCS" ]; then
    for pid in $AGENT_PROCS; do
        print_status "Agent Process" "Running (PID: $pid)" "success"
        # Get process info
        if command -v ps &> /dev/null; then
            CPU=$(ps -p "$pid" -o %cpu= 2>/dev/null || echo "N/A")
            MEM=$(ps -p "$pid" -o %mem= 2>/dev/null || echo "N/A")
            STARTED=$(ps -p "$pid" -o lstart= 2>/dev/null || echo "N/A")
            print_subitem "CPU: ${CPU}%  Memory: ${MEM}%"
            print_subitem "Started: $STARTED"
        fi
    done
else
    print_status "Agent Process" "NOT RUNNING" "error"
    ISSUES+=("Agent process is not running")
fi

if [ -n "$HELPER_PROCS" ]; then
    for pid in $HELPER_PROCS; do
        print_status "Helper Process" "Running (PID: $pid)" "success"
    done
else
    print_status "Helper Process" "Not running (optional)" "info"
fi

# ============================================================================
# 4. INSTALLATION & BINARY CHECK
# ============================================================================
print_header "4. Installation & Binary Architecture"

if [ -d "$INSTALL_DIR" ]; then
    print_status "Install Directory" "$INSTALL_DIR" "success"

    if [ -f "$AGENT_BIN" ]; then
        print_status "Agent Binary" "Found" "success"

        # Check file size
        SIZE=$(ls -lh "$AGENT_BIN" | awk '{print $5}')
        print_subitem "Size: $SIZE"

        # Check binary architecture - THIS IS IMPORTANT FOR THE ERROR
        if command -v file &> /dev/null; then
            BIN_ARCH=$(file "$AGENT_BIN")
            print_subitem "Binary info: $BIN_ARCH"

            # Check architecture match
            if [ "$ARCH" = "arm64" ]; then
                if echo "$BIN_ARCH" | grep -q "arm64"; then
                    print_status "Architecture Match" "Binary is native arm64" "success"
                elif echo "$BIN_ARCH" | grep -q "x86_64"; then
                    print_status "Architecture Match" "Binary is x86_64 (will use Rosetta)" "warning"
                    ISSUES+=("Binary is x86_64 on Apple Silicon - may cause issues")
                else
                    print_status "Architecture Match" "UNKNOWN ARCHITECTURE" "error"
                    ISSUES+=("Binary architecture is unknown or corrupt")
                fi
            else
                if echo "$BIN_ARCH" | grep -q "x86_64"; then
                    print_status "Architecture Match" "Binary is native x86_64" "success"
                else
                    print_status "Architecture Match" "Binary architecture mismatch" "error"
                    ISSUES+=("Binary architecture does not match system")
                fi
            fi

            # Check if binary is valid executable
            if ! echo "$BIN_ARCH" | grep -q "Mach-O"; then
                print_status "Binary Validity" "NOT A VALID EXECUTABLE" "error"
                ISSUES+=("Agent binary is not a valid Mach-O executable - may be corrupt")
            fi
        fi

        # Check if binary is signed
        if command -v codesign &> /dev/null; then
            if codesign -v "$AGENT_BIN" 2>/dev/null; then
                print_status "Code Signature" "Valid" "success"
            else
                print_status "Code Signature" "Not signed or invalid" "warning"
            fi
        fi

        # Check permissions
        PERMS=$(stat -f "%OLp" "$AGENT_BIN" 2>/dev/null || stat -c "%a" "$AGENT_BIN" 2>/dev/null)
        print_subitem "Permissions: $PERMS"

    else
        print_status "Agent Binary" "NOT FOUND" "error"
        print_subitem "Expected: $AGENT_BIN" "${RED}"
        ISSUES+=("Agent binary not found")
    fi

    # Check helper binary
    if [ -f "$HELPER_BIN" ]; then
        print_status "Helper Binary" "Found" "success"
    else
        print_status "Helper Binary" "Not installed (optional)" "info"
    fi
else
    print_status "Install Directory" "NOT FOUND" "error"
    ISSUES+=("Installation directory not found")
fi

# ============================================================================
# 5. CONFIGURATION
# ============================================================================
print_header "5. Configuration"

if [ -d "$DATA_DIR" ]; then
    print_status "Data Directory" "$DATA_DIR" "success"
else
    print_status "Data Directory" "NOT FOUND" "error"
    ISSUES+=("Data directory not found")
fi

if [ -f "$CONFIG_FILE" ]; then
    print_status "Config File" "Found" "success"

    # Parse config with python or jq
    if command -v python3 &> /dev/null; then
        AGENT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('agentId', 'NOT SET'))" 2>/dev/null || echo "PARSE ERROR")
        AUTH_TOKEN=$(python3 -c "import json; t=json.load(open('$CONFIG_FILE')).get('authToken'); print('[CONFIGURED]' if t else 'NOT SET')" 2>/dev/null || echo "PARSE ERROR")
        PARENT_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('parentApiUrl', 'NOT SET'))" 2>/dev/null || echo "PARSE ERROR")
        CHECK_INT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('checkInterval', 30000))" 2>/dev/null || echo "N/A")
        LOG_LEVEL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('logLevel', 'info'))" 2>/dev/null || echo "N/A")

        if [ "$AGENT_ID" != "NOT SET" ] && [ "$AGENT_ID" != "PARSE ERROR" ]; then
            print_subitem "Agent ID: $AGENT_ID" "${GREEN}"
        else
            print_subitem "Agent ID: NOT SET" "${RED}"
            ISSUES+=("Agent ID not configured")
        fi

        if [ "$AUTH_TOKEN" = "[CONFIGURED]" ]; then
            print_subitem "Auth Token: [CONFIGURED]" "${GREEN}"
        else
            print_subitem "Auth Token: NOT SET" "${RED}"
            ISSUES+=("Auth token not configured")
        fi

        if [ "$PARENT_URL" != "NOT SET" ] && [ "$PARENT_URL" != "PARSE ERROR" ]; then
            print_subitem "Parent URL: $PARENT_URL" "${GREEN}"
        else
            print_subitem "Parent URL: NOT SET" "${YELLOW}"
        fi

        print_subitem "Check Interval: ${CHECK_INT}ms"
        print_subitem "Log Level: $LOG_LEVEL"

    elif command -v jq &> /dev/null; then
        AGENT_ID=$(jq -r '.agentId // "NOT SET"' "$CONFIG_FILE" 2>/dev/null)
        print_subitem "Agent ID: $AGENT_ID"
    else
        print_subitem "Install python3 or jq to parse config"
        cat "$CONFIG_FILE"
    fi
else
    print_status "Config File" "NOT FOUND" "error"
    print_subitem "Expected: $CONFIG_FILE" "${RED}"
    ISSUES+=("Configuration file not found")
fi

# ============================================================================
# 6. LOG FILES
# ============================================================================
print_header "6. Log Files"

if [ -d "$LOG_DIR" ]; then
    print_status "Log Directory" "$LOG_DIR" "success"

    # List log files
    for logfile in "$LOG_DIR"/*.log; do
        if [ -f "$logfile" ]; then
            SIZE=$(ls -lh "$logfile" | awk '{print $5}')
            MODIFIED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$logfile" 2>/dev/null || stat -c "%y" "$logfile" 2>/dev/null | cut -d. -f1)
            print_subitem "$(basename "$logfile"): $SIZE (Modified: $MODIFIED)"
        fi
    done
else
    print_status "Log Directory" "NOT FOUND" "warning"
    print_subitem "Expected: $LOG_DIR"
fi

# Show recent main log
if [ -f "$MAIN_LOG" ]; then
    echo ""
    echo -e "  ${CYAN}Recent Agent Log Entries:${NC}"
    echo "  --------------------------------------------------"
    tail -50 "$MAIN_LOG" | while IFS= read -r line; do
        if echo "$line" | grep -qi "error\|fail\|exception"; then
            echo -e "    ${RED}$line${NC}"
        elif echo "$line" | grep -qi "warn"; then
            echo -e "    ${YELLOW}$line${NC}"
        else
            echo "    $line"
        fi
    done
fi

# Show recent error log
if [ -f "$ERROR_LOG" ] && [ -s "$ERROR_LOG" ]; then
    echo ""
    echo -e "  ${RED}Recent Error Log Entries:${NC}"
    echo "  --------------------------------------------------"
    tail -20 "$ERROR_LOG" | while IFS= read -r line; do
        echo -e "    ${RED}$line${NC}"
    done
fi

# Check system log for agent entries
echo ""
echo -e "  ${CYAN}Recent System Log Entries:${NC}"
echo "  --------------------------------------------------"
log show --predicate 'process == "allow2automate-agent"' --last 5m 2>/dev/null | tail -20 || echo "    (No recent entries or requires sudo)"

# ============================================================================
# 7. NETWORK
# ============================================================================
print_header "7. Network Status"

# Check if agent API is listening
API_PORT=8443
if [ -n "$CHECK_INT" ]; then
    API_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiPort', 8443))" 2>/dev/null || echo "8443")
fi

if lsof -i ":$API_PORT" &>/dev/null; then
    print_status "Agent API Port ($API_PORT)" "Listening" "success"
else
    print_status "Agent API Port ($API_PORT)" "Not listening" "warning"
fi

# Check parent connectivity
if [ -n "$PARENT_URL" ] && [ "$PARENT_URL" != "NOT SET" ] && [ "$PARENT_URL" != "PARSE ERROR" ]; then
    # Extract host and port from URL
    HOST=$(echo "$PARENT_URL" | sed -E 's|https?://([^:/]+).*|\1|')
    PORT=$(echo "$PARENT_URL" | sed -E 's|https?://[^:]+:?([0-9]*)/.*|\1|')
    PORT=${PORT:-80}

    if nc -z -w 5 "$HOST" "$PORT" 2>/dev/null; then
        print_status "Parent API" "Reachable ($HOST:$PORT)" "success"
    else
        print_status "Parent API" "NOT reachable ($HOST:$PORT)" "error"
        ISSUES+=("Cannot reach parent API at $HOST:$PORT")
    fi
fi

# Check mDNS
if pgrep -x "mDNSResponder" &>/dev/null; then
    print_status "mDNS (Bonjour)" "Running" "success"
else
    print_status "mDNS (Bonjour)" "Not running" "warning"
fi

# ============================================================================
# 8. PERMISSIONS & SECURITY
# ============================================================================
print_header "8. Permissions & Security"

# Check TCC/Privacy permissions
print_status "Full Disk Access" "Check System Preferences > Security & Privacy > Privacy" "info"

# Check if binary can be executed
if [ -x "$AGENT_BIN" ]; then
    print_status "Binary Executable" "Yes" "success"
else
    print_status "Binary Executable" "No - missing execute permission" "error"
    ISSUES+=("Agent binary is not executable")
fi

# Gatekeeper check
if command -v spctl &> /dev/null; then
    if spctl -a -v "$AGENT_BIN" 2>&1 | grep -q "accepted"; then
        print_status "Gatekeeper" "Accepted" "success"
    else
        print_status "Gatekeeper" "May be blocked" "warning"
        print_subitem "Run: sudo spctl --master-disable (temporarily) or right-click > Open"
    fi
fi

# ============================================================================
# SUMMARY
# ============================================================================
print_header "DIAGNOSTIC SUMMARY"

if [ ${#ISSUES[@]} -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}All checks passed! The agent appears to be running correctly.${NC}"
    echo ""
else
    echo ""
    echo -e "  ${RED}Issues Found: ${#ISSUES[@]}${NC}"
    echo ""
    for issue in "${ISSUES[@]}"; do
        echo -e "    ${RED}- $issue${NC}"
    done
    echo ""
    echo -e "  ${YELLOW}Suggested Actions:${NC}"

    for issue in "${ISSUES[@]}"; do
        case "$issue" in
            *"not installed"*)
                echo -e "    ${YELLOW}1. Install the agent using the installer from the parent app${NC}"
                ;;
            *"not loaded"*)
                echo -e "    ${YELLOW}2. Load the service: sudo launchctl load $PLIST_FILE${NC}"
                ;;
            *"not running"*)
                echo -e "    ${YELLOW}3. Start the service: sudo launchctl start $SERVICE_LABEL${NC}"
                ;;
            *"Configuration file not found"*|*"not configured"*)
                echo -e "    ${YELLOW}4. Download a new installer with config from the parent app${NC}"
                ;;
            *"corrupt"*|*"architecture"*)
                echo -e "    ${YELLOW}5. Re-download installer - binary may be corrupt or wrong architecture${NC}"
                echo -e "    ${YELLOW}   For Apple Silicon: ensure you have the arm64 build${NC}"
                echo -e "    ${YELLOW}   For Intel Mac: ensure you have the x86_64 build${NC}"
                ;;
            *"Cannot reach parent"*)
                echo -e "    ${YELLOW}6. Check network connectivity and firewall settings${NC}"
                ;;
        esac
    done
    echo ""
fi

# Quick commands reference
echo -e "  ${CYAN}Quick Commands:${NC}"
echo "    Load Service:     sudo launchctl load $PLIST_FILE"
echo "    Unload Service:   sudo launchctl unload $PLIST_FILE"
echo "    Start Service:    sudo launchctl start $SERVICE_LABEL"
echo "    Stop Service:     sudo launchctl stop $SERVICE_LABEL"
echo "    View Logs:        tail -100 $MAIN_LOG"
echo "    Follow Logs:      tail -f $MAIN_LOG"
echo "    Check Binary:     file $AGENT_BIN"
echo ""

# Special note about the SyntaxError
if [ ${#ISSUES[@]} -gt 0 ]; then
    for issue in "${ISSUES[@]}"; do
        if [[ "$issue" == *"corrupt"* ]] || [[ "$issue" == *"architecture"* ]]; then
            echo -e "  ${RED}NOTE: If you see 'SyntaxError: Invalid or unexpected token' in${NC}"
            echo -e "  ${RED}pkg/prelude/bootstrap.js, the binary is corrupt or for the wrong${NC}"
            echo -e "  ${RED}architecture. Re-download the correct installer for your Mac:${NC}"
            echo -e "  ${YELLOW}  - Apple Silicon (M1/M2/M3): arm64 build${NC}"
            echo -e "  ${YELLOW}  - Intel Mac: x86_64 build${NC}"
            echo ""
            break
        fi
    done
fi
