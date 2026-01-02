# Installation Guide - Allow2 Automate Agent

## ⚠️ IMPORTANT

**This agent is NOT designed for direct installation by end users.**

The Allow2 Automate Agent **must** be configured with connection details to communicate with an Allow2 Automate server. The agent requires:

1. **Parent API URL** - IP address or hostname of the Allow2 Automate server
2. **mDNS Discovery** - Network must support multicast for auto-discovery
3. **Authentication Token** - JWT token provided during pairing with parent server

**End users should install the agent using the pre-configured installers** which are downloaded from the Allow2 Automate application.

## Prerequisites

- Node.js >= 18.0.0 (bundled in installers)
- npm (comes with Node.js - only for development)
- Administrator/root privileges for system service installation

## Development Installation

### 1. Install Dependencies

```bash
cd /mnt/ai/automate/allow2automate-agent
npm install
```

### 2. Run in Development Mode

```bash
# Start the agent in development mode
npm run start:dev

# Or run directly
node src/index.js
```

The agent will start on port 8443 and begin monitoring processes.

### 3. Verify Installation

Check if the agent is running:

```bash
# Health check
curl http://localhost:8443/api/health

# Expected output:
{
  "status": "ok",
  "version": "1.0.0",
  "agentId": "...",
  "hostname": "...",
  "platform": "linux",
  "uptime": 123,
  "monitoringActive": true
}
```

### 4. Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Configuration

### Default Configuration

The agent looks for configuration in platform-specific locations:

- **Linux**: `/etc/allow2/agent/config.json`
- **Windows**: `C:\ProgramData\Allow2\agent\config.json`
- **macOS**: `/Library/Application Support/Allow2/agent/config.json`

### Example Configuration

```json
{
  "agentId": "unique-agent-id",
  "parentApiUrl": "https://parent-api.example.com",
  "authToken": "jwt-secret-token",
  "apiPort": 8443,
  "checkInterval": 30000,
  "logLevel": "info",
  "enableMDNS": true,
  "autoUpdate": true
}
```

### Environment Variables

You can also configure via environment variables:

```bash
export ALLOW2_API_PORT=8443
export ALLOW2_LOG_LEVEL=debug
export NODE_ENV=development
npm start
```

## Production Deployment

### System Service Installation

#### Linux (systemd)

Create service file at `/etc/systemd/system/allow2-agent.service`:

```ini
[Unit]
Description=Allow2 Automate Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/allow2-agent
ExecStart=/usr/bin/node /opt/allow2-agent/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=allow2-agent

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable allow2-agent
sudo systemctl start allow2-agent
sudo systemctl status allow2-agent
```

#### macOS (launchd)

Create plist at `/Library/LaunchDaemons/com.allow2.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.allow2.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/opt/allow2-agent/src/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Library/Logs/Allow2/agent/stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Library/Logs/Allow2/agent/stderr.log</string>
</dict>
</plist>
```

Load the service:

```bash
sudo launchctl load /Library/LaunchDaemons/com.allow2.agent.plist
sudo launchctl start com.allow2.agent
```

#### Windows (NSSM)

Use NSSM (Non-Sucking Service Manager):

```powershell
# Download and install NSSM
# Then install the service:

nssm install Allow2Agent "C:\Program Files\nodejs\node.exe" "C:\Program Files\Allow2\agent\src\index.js"
nssm set Allow2Agent AppDirectory "C:\Program Files\Allow2\agent"
nssm set Allow2Agent DisplayName "Allow2 Automate Agent"
nssm set Allow2Agent Description "Process monitoring and parental controls"
nssm set Allow2Agent Start SERVICE_AUTO_START

# Start the service
nssm start Allow2Agent
```

### Building Installers

#### Windows MSI

```bash
npm run build:windows
# Generates installer in installers/windows/output/
```

#### macOS PKG

```bash
npm run build:macos
# Generates installer in installers/macos/output/
```

#### Linux DEB/RPM

```bash
npm run build:linux
# Generates packages in installers/linux/output/
```

## Initial Setup (Production Use)

### 1. Agent Pairing Process

**The agent MUST be paired with an Allow2 Automate server before it can function.**

Pairing workflow:

1. User installs agent on target device (Windows/macOS/Linux)
2. Agent starts and advertises itself via mDNS (Bonjour)
3. Allow2 Automate server discovers agent on local network
4. Server sends pairing request with connection details
5. Agent saves configuration:
   - `parentApiUrl`: Server IP/hostname
   - `agentId`: Unique agent identifier
   - `authToken`: JWT for authenticated communication
6. Agent begins monitoring processes and reporting to server

**Without pairing, the agent will run but has no policies to enforce.**

### 2. Creating Policies

Via REST API:

```bash
curl -X POST http://localhost:8443/api/policies \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "policy-1",
    "processName": "game.exe",
    "allowed": false,
    "schedule": {
      "startTime": "14:00",
      "endTime": "16:00",
      "days": [1, 2, 3, 4, 5]
    }
  }'
```

### 3. Verifying Operation

Check monitoring status:

```bash
curl http://localhost:8443/api/monitor/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

View running processes:

```bash
curl http://localhost:8443/api/processes \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Troubleshooting

### Agent Won't Start

1. Check Node.js version: `node --version` (should be >= 18.0.0)
2. Check logs in platform-specific location
3. Verify port 8443 is available: `lsof -i :8443` (Linux/macOS) or `netstat -ano | findstr :8443` (Windows)
4. Check permissions (needs root/admin for process termination)

### Process Not Being Killed

1. Verify agent is running: `curl http://localhost:8443/api/health`
2. Check policy is active: `curl http://localhost:8443/api/policies -H "Authorization: Bearer TOKEN"`
3. Verify process name matches exactly (case-sensitive on Unix)
4. Check agent has sufficient privileges
5. Review logs for errors

### mDNS Not Working

1. Ensure `enableMDNS: true` in config
2. Check firewall allows port 5353 (mDNS)
3. Verify Bonjour/Avahi is running
4. Check network supports multicast

### High CPU Usage

1. Increase `checkInterval` in config (default 30000ms)
2. Reduce number of active policies
3. Check for process name wildcards causing excessive checks

## Security Considerations

1. **Secrets Management**: Never commit authToken to version control
2. **File Permissions**: Config files should be 0600 (owner read/write only)
3. **API Access**: Always use JWT authentication
4. **Network**: Consider using HTTPS with proper certificates
5. **Updates**: Keep agent updated for security patches

## Monitoring

### Logs

View logs:

```bash
# Linux
tail -f /var/log/allow2/agent/agent.log

# macOS
tail -f /Library/Logs/Allow2/agent/agent.log

# Windows
type "C:\ProgramData\Allow2\agent\logs\agent.log"
```

### Metrics

The agent exposes metrics via API:

```bash
curl http://localhost:8443/api/monitor/status -H "Authorization: Bearer TOKEN"
```

Returns:
- `isRunning`: Monitoring active
- `checkInterval`: Current interval
- `violationCount`: Recent violations
- `lastCheck`: Last check timestamp

## Uninstallation

### Linux

```bash
sudo systemctl stop allow2-agent
sudo systemctl disable allow2-agent
sudo rm /etc/systemd/system/allow2-agent.service
sudo rm -rf /opt/allow2-agent
sudo rm -rf /etc/allow2
sudo rm -rf /var/log/allow2
```

### macOS

```bash
sudo launchctl unload /Library/LaunchDaemons/com.allow2.agent.plist
sudo rm /Library/LaunchDaemons/com.allow2.agent.plist
sudo rm -rf /opt/allow2-agent
sudo rm -rf "/Library/Application Support/Allow2"
sudo rm -rf /Library/Logs/Allow2
```

### Windows

```powershell
nssm stop Allow2Agent
nssm remove Allow2Agent confirm
# Then uninstall via Control Panel or:
wmic product where name="Allow2 Automate Agent" call uninstall
```

## Support

- Documentation: README.md
- Issues: GitHub Issues
- Logs: Check platform-specific log locations
