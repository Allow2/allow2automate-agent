#!/bin/bash
#
# Allow2 Automate Agent - Linux Diagnostic Script
#
# This script checks the status of all Allow2 Automate Agent components on Linux:
# - Systemd service status
# - Running processes
# - Configuration file
# - Log files
# - Network connectivity
# - System requirements
#
# Supports: Ubuntu, Debian, Fedora, RHEL, CentOS, Rocky, AlmaLinux, openSUSE
#
# Usage: sudo ./diagnose-linux.sh
#

set -e

# Colors (disabled if not a tty)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    MAGENTA=''
    CYAN=''
    NC=''
fi

# Configuration paths
SERVICE_NAME="allow2automate-agent"
INSTALL_DIR="/usr/local/share/allow2automate-agent"
DATA_DIR="/etc/allow2/agent"
CONFIG_FILE="${DATA_DIR}/config.json"
LOG_DIR="/var/log/allow2/agent"
MAIN_LOG="${LOG_DIR}/agent.log"
ERROR_LOG="${LOG_DIR}/error.log"
AGENT_BIN="${INSTALL_DIR}/allow2automate-agent"
SYSTEMD_UNIT="/etc/systemd/system/${SERVICE_NAME}.service"

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
    local status="$3"

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

# Detect distribution
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO="$ID"
        DISTRO_NAME="$NAME"
        DISTRO_VERSION="$VERSION_ID"
        DISTRO_LIKE="$ID_LIKE"
    elif command -v lsb_release &> /dev/null; then
        DISTRO=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        DISTRO_NAME=$(lsb_release -sd)
        DISTRO_VERSION=$(lsb_release -sr)
    else
        DISTRO="unknown"
        DISTRO_NAME="Unknown Linux"
        DISTRO_VERSION="unknown"
    fi
}

# Detect package manager
detect_package_manager() {
    if command -v apt &> /dev/null; then
        PKG_MGR="apt"
        PKG_TYPE="deb"
    elif command -v dnf &> /dev/null; then
        PKG_MGR="dnf"
        PKG_TYPE="rpm"
    elif command -v yum &> /dev/null; then
        PKG_MGR="yum"
        PKG_TYPE="rpm"
    elif command -v zypper &> /dev/null; then
        PKG_MGR="zypper"
        PKG_TYPE="rpm"
    elif command -v pacman &> /dev/null; then
        PKG_MGR="pacman"
        PKG_TYPE="pkg"
    else
        PKG_MGR="unknown"
        PKG_TYPE="unknown"
    fi
}

echo ""
echo -e "${MAGENTA}Allow2 Automate Agent - Linux Diagnostics${NC}"
echo -e "${MAGENTA}===========================================${NC}"
echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Hostname:  $(hostname)"
echo "User:      $(whoami)"

check_root
detect_distro
detect_package_manager

# ============================================================================
# 1. SYSTEM INFO
# ============================================================================
print_header "1. System Information"

print_status "Distribution" "$DISTRO_NAME" "info"
print_status "Version" "$DISTRO_VERSION" "info"
print_status "Package Manager" "$PKG_MGR ($PKG_TYPE)" "info"

# Architecture
ARCH=$(uname -m)
print_status "Architecture" "$ARCH" "info"

# Kernel
KERNEL=$(uname -r)
print_status "Kernel" "$KERNEL" "info"

# Check systemd
if command -v systemctl &> /dev/null; then
    print_status "Init System" "systemd" "success"
else
    print_status "Init System" "NOT systemd (unsupported)" "error"
    ISSUES+=("This script requires systemd")
fi

# ============================================================================
# 2. SERVICE STATUS
# ============================================================================
print_header "2. Service Status (systemd)"

if [ -f "$SYSTEMD_UNIT" ]; then
    print_status "Unit File" "Found" "success"
    print_subitem "$SYSTEMD_UNIT"

    # Check if service is enabled
    if systemctl is-enabled "$SERVICE_NAME" &>/dev/null; then
        print_status "Enabled" "Yes (starts at boot)" "success"
    else
        print_status "Enabled" "No (won't start at boot)" "warning"
    fi

    # Check if service is active
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        print_status "Status" "Running" "success"

        # Get PID
        PID=$(systemctl show -p MainPID --value "$SERVICE_NAME" 2>/dev/null)
        if [ -n "$PID" ] && [ "$PID" != "0" ]; then
            print_status "Process ID" "$PID" "success"
        fi

        # Get memory usage
        MEM=$(systemctl show -p MemoryCurrent --value "$SERVICE_NAME" 2>/dev/null)
        if [ -n "$MEM" ] && [ "$MEM" != "[not set]" ]; then
            MEM_MB=$((MEM / 1024 / 1024))
            print_subitem "Memory: ${MEM_MB} MB"
        fi
    else
        print_status "Status" "NOT RUNNING" "error"
        ISSUES+=("Service is not running")

        # Check why it's not running
        EXIT_CODE=$(systemctl show -p ExecMainStatus --value "$SERVICE_NAME" 2>/dev/null)
        if [ -n "$EXIT_CODE" ] && [ "$EXIT_CODE" != "0" ]; then
            print_status "Last Exit Code" "$EXIT_CODE" "error"
            ISSUES+=("Service exited with code $EXIT_CODE")
        fi
    fi

    # Show brief status
    echo ""
    echo -e "  ${CYAN}Service Status Output:${NC}"
    echo "  --------------------------------------------------"
    systemctl status "$SERVICE_NAME" --no-pager 2>&1 | head -15 | sed 's/^/    /'

else
    print_status "Unit File" "NOT FOUND" "error"
    print_subitem "Expected: $SYSTEMD_UNIT" "${RED}"
    ISSUES+=("Systemd unit file not found - agent not installed")
fi

# ============================================================================
# 3. PROCESS STATUS
# ============================================================================
print_header "3. Running Processes"

AGENT_PROCS=$(pgrep -f "allow2automate-agent" 2>/dev/null || true)

if [ -n "$AGENT_PROCS" ]; then
    for pid in $AGENT_PROCS; do
        print_status "Agent Process" "Running (PID: $pid)" "success"
        if [ -d "/proc/$pid" ]; then
            # Get process info
            CPU=$(ps -p "$pid" -o %cpu= 2>/dev/null | tr -d ' ')
            MEM=$(ps -p "$pid" -o %mem= 2>/dev/null | tr -d ' ')
            STARTED=$(ps -p "$pid" -o lstart= 2>/dev/null)
            print_subitem "CPU: ${CPU}%  Memory: ${MEM}%"
            print_subitem "Started: $STARTED"
        fi
    done
else
    print_status "Agent Process" "NOT RUNNING" "error"
    ISSUES+=("Agent process is not running")
fi

# ============================================================================
# 4. INSTALLATION
# ============================================================================
print_header "4. Installation"

if [ -d "$INSTALL_DIR" ]; then
    print_status "Install Directory" "$INSTALL_DIR" "success"

    if [ -f "$AGENT_BIN" ]; then
        print_status "Agent Binary" "Found" "success"

        # Check file info
        SIZE=$(ls -lh "$AGENT_BIN" | awk '{print $5}')
        print_subitem "Size: $SIZE"

        # Check binary type
        if command -v file &> /dev/null; then
            BIN_INFO=$(file "$AGENT_BIN")
            print_subitem "Type: $BIN_INFO"

            # Verify it's an executable
            if ! echo "$BIN_INFO" | grep -q "executable\|ELF"; then
                print_status "Binary Validity" "May not be a valid executable" "warning"
                ISSUES+=("Agent binary may be corrupt")
            fi
        fi

        # Check architecture match
        if command -v file &> /dev/null; then
            if [ "$ARCH" = "x86_64" ]; then
                if echo "$BIN_INFO" | grep -q "x86-64\|x86_64"; then
                    print_status "Architecture Match" "Binary is x86_64" "success"
                elif echo "$BIN_INFO" | grep -q "aarch64\|ARM"; then
                    print_status "Architecture Match" "MISMATCH - Binary is ARM on x86_64 system" "error"
                    ISSUES+=("Binary architecture mismatch")
                fi
            elif [ "$ARCH" = "aarch64" ]; then
                if echo "$BIN_INFO" | grep -q "aarch64\|ARM"; then
                    print_status "Architecture Match" "Binary is ARM64" "success"
                elif echo "$BIN_INFO" | grep -q "x86-64\|x86_64"; then
                    print_status "Architecture Match" "MISMATCH - Binary is x86_64 on ARM system" "error"
                    ISSUES+=("Binary architecture mismatch")
                fi
            fi
        fi

        # Check permissions
        if [ -x "$AGENT_BIN" ]; then
            print_status "Executable" "Yes" "success"
        else
            print_status "Executable" "No - missing execute permission" "error"
            ISSUES+=("Agent binary is not executable")
        fi
    else
        print_status "Agent Binary" "NOT FOUND" "error"
        print_subitem "Expected: $AGENT_BIN" "${RED}"
        ISSUES+=("Agent binary not found")
    fi
else
    print_status "Install Directory" "NOT FOUND" "error"
    ISSUES+=("Installation directory not found")
fi

# Check if installed via package manager
echo ""
echo -e "  ${CYAN}Package Installation:${NC}"
case "$PKG_MGR" in
    apt)
        if dpkg -l | grep -q "allow2automate-agent"; then
            dpkg -l | grep "allow2automate-agent" | sed 's/^/    /'
        else
            echo "    Not installed via apt/dpkg"
        fi
        ;;
    dnf|yum)
        if rpm -qa | grep -q "allow2automate-agent"; then
            rpm -qi allow2automate-agent 2>/dev/null | head -10 | sed 's/^/    /'
        else
            echo "    Not installed via rpm"
        fi
        ;;
    *)
        echo "    Package check not available for $PKG_MGR"
        ;;
esac

# ============================================================================
# 5. CONFIGURATION
# ============================================================================
print_header "5. Configuration"

if [ -d "$DATA_DIR" ]; then
    print_status "Config Directory" "$DATA_DIR" "success"
else
    print_status "Config Directory" "NOT FOUND" "error"
    ISSUES+=("Configuration directory not found")
fi

if [ -f "$CONFIG_FILE" ]; then
    print_status "Config File" "Found" "success"

    # Check permissions (should be 600)
    PERMS=$(stat -c "%a" "$CONFIG_FILE" 2>/dev/null)
    if [ "$PERMS" = "600" ]; then
        print_subitem "Permissions: $PERMS (secure)" "${GREEN}"
    else
        print_subitem "Permissions: $PERMS (should be 600)" "${YELLOW}"
    fi

    # Parse config
    if command -v python3 &> /dev/null; then
        AGENT_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('agentId', 'NOT SET'))" 2>/dev/null || echo "PARSE ERROR")
        AUTH_TOKEN=$(python3 -c "import json; t=json.load(open('$CONFIG_FILE')).get('authToken'); print('[CONFIGURED]' if t else 'NOT SET')" 2>/dev/null || echo "PARSE ERROR")
        PARENT_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('parentApiUrl', 'NOT SET'))" 2>/dev/null || echo "PARSE ERROR")
        CHECK_INT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('checkInterval', 30000))" 2>/dev/null || echo "N/A")
        LOG_LEVEL=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('logLevel', 'info'))" 2>/dev/null || echo "N/A")
        API_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('apiPort', 8443))" 2>/dev/null || echo "8443")

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
        print_subitem "API Port: $API_PORT"

    elif command -v jq &> /dev/null; then
        AGENT_ID=$(jq -r '.agentId // "NOT SET"' "$CONFIG_FILE" 2>/dev/null)
        print_subitem "Agent ID: $AGENT_ID"
        API_PORT=$(jq -r '.apiPort // 8443' "$CONFIG_FILE" 2>/dev/null)
    else
        print_subitem "Install python3 or jq to parse config details"
        API_PORT="8443"
    fi
else
    print_status "Config File" "NOT FOUND" "error"
    print_subitem "Expected: $CONFIG_FILE" "${RED}"
    ISSUES+=("Configuration file not found")
    API_PORT="8443"
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
            MODIFIED=$(stat -c "%y" "$logfile" 2>/dev/null | cut -d. -f1)
            print_subitem "$(basename "$logfile"): $SIZE (Modified: $MODIFIED)"
        fi
    done
else
    print_status "Log Directory" "NOT FOUND" "warning"
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

# Show journalctl output
echo ""
echo -e "  ${CYAN}Recent Journal Entries:${NC}"
echo "  --------------------------------------------------"
journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null | sed 's/^/    /' || echo "    (journalctl not available or requires sudo)"

# ============================================================================
# 7. NETWORK
# ============================================================================
print_header "7. Network Status"

# Check if agent API is listening
if command -v ss &> /dev/null; then
    if ss -tlnp 2>/dev/null | grep -q ":${API_PORT}"; then
        print_status "Agent API Port ($API_PORT)" "Listening" "success"
    else
        print_status "Agent API Port ($API_PORT)" "Not listening" "warning"
    fi
elif command -v netstat &> /dev/null; then
    if netstat -tlnp 2>/dev/null | grep -q ":${API_PORT}"; then
        print_status "Agent API Port ($API_PORT)" "Listening" "success"
    else
        print_status "Agent API Port ($API_PORT)" "Not listening" "warning"
    fi
fi

# Check parent connectivity
if [ -n "$PARENT_URL" ] && [ "$PARENT_URL" != "NOT SET" ] && [ "$PARENT_URL" != "PARSE ERROR" ]; then
    HOST=$(echo "$PARENT_URL" | sed -E 's|https?://([^:/]+).*|\1|')
    PORT=$(echo "$PARENT_URL" | sed -E 's|https?://[^:]+:?([0-9]*)/.*|\1|')
    PORT=${PORT:-80}

    if command -v nc &> /dev/null; then
        if nc -z -w 5 "$HOST" "$PORT" 2>/dev/null; then
            print_status "Parent API" "Reachable ($HOST:$PORT)" "success"
        else
            print_status "Parent API" "NOT reachable ($HOST:$PORT)" "error"
            ISSUES+=("Cannot reach parent API at $HOST:$PORT")
        fi
    elif command -v curl &> /dev/null; then
        if curl -s --connect-timeout 5 "$PARENT_URL" &>/dev/null; then
            print_status "Parent API" "Reachable" "success"
        else
            print_status "Parent API" "NOT reachable" "error"
            ISSUES+=("Cannot reach parent API")
        fi
    fi
fi

# Check mDNS (Avahi)
if command -v avahi-daemon &> /dev/null; then
    if systemctl is-active --quiet avahi-daemon; then
        print_status "mDNS (Avahi)" "Running" "success"
    else
        print_status "mDNS (Avahi)" "Not running" "warning"
    fi
else
    print_status "mDNS (Avahi)" "Not installed" "info"
fi

# Firewall check
echo ""
echo -e "  ${CYAN}Firewall Status:${NC}"
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1)
    print_subitem "UFW: $UFW_STATUS"
elif command -v firewall-cmd &> /dev/null; then
    FW_STATUS=$(firewall-cmd --state 2>/dev/null || echo "unknown")
    print_subitem "firewalld: $FW_STATUS"
else
    print_subitem "No common firewall detected"
fi

# ============================================================================
# 8. SYSTEM RESOURCES
# ============================================================================
print_header "8. System Resources"

# Memory
MEM_TOTAL=$(free -m | awk '/^Mem:/{print $2}')
MEM_FREE=$(free -m | awk '/^Mem:/{print $4}')
MEM_AVAIL=$(free -m | awk '/^Mem:/{print $7}')
print_status "Memory" "${MEM_AVAIL}MB available of ${MEM_TOTAL}MB" "info"

# Disk
DISK_FREE=$(df -h / | awk 'NR==2{print $4}')
DISK_USED=$(df -h / | awk 'NR==2{print $5}')
print_status "Disk Space (/)" "$DISK_FREE free ($DISK_USED used)" "info"

# Load
LOAD=$(uptime | awk -F'load average:' '{print $2}' | tr -d ' ')
print_status "Load Average" "$LOAD" "info"

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
            *"not installed"*|*"not found"*)
                echo -e "    ${YELLOW}1. Install the agent using the install script from the parent app${NC}"
                ;;
            *"not running"*)
                echo -e "    ${YELLOW}2. Start the service: sudo systemctl start $SERVICE_NAME${NC}"
                ;;
            *"Configuration"*|*"not configured"*)
                echo -e "    ${YELLOW}3. Download a new installer with config from the parent app${NC}"
                ;;
            *"corrupt"*|*"architecture"*)
                echo -e "    ${YELLOW}4. Re-download installer - binary may be corrupt or wrong architecture${NC}"
                ;;
            *"Cannot reach"*)
                echo -e "    ${YELLOW}5. Check network/firewall: sudo ufw allow $API_PORT${NC}"
                ;;
        esac
    done
    echo ""
fi

# Quick commands reference
echo -e "  ${CYAN}Quick Commands:${NC}"
echo "    Start Service:    sudo systemctl start $SERVICE_NAME"
echo "    Stop Service:     sudo systemctl stop $SERVICE_NAME"
echo "    Restart Service:  sudo systemctl restart $SERVICE_NAME"
echo "    Enable at Boot:   sudo systemctl enable $SERVICE_NAME"
echo "    Service Status:   sudo systemctl status $SERVICE_NAME"
echo "    View Logs:        tail -100 $MAIN_LOG"
echo "    Follow Logs:      sudo journalctl -u $SERVICE_NAME -f"
echo ""
