# Allow2Automate Agent Helper

User-space companion app for the Allow2Automate Agent system service.

## Purpose

The main agent runs as a privileged system service (root/SYSTEM) and cannot display GUI elements. This helper runs in the user's session and provides:

- **System Tray Icon**: Shows agent connection status at a glance
- **Desktop Notifications**: Alerts for connection issues, policy actions, and warnings
- **Status Monitoring**: Polls the main agent and displays current state

## Architecture

```
┌─────────────────────────────────┐
│  Agent Service (System/Root)    │
│  Port: 8443                     │
│  - Process monitoring           │
│  - Policy enforcement           │
│  - Parent server communication  │
│  - HTTP API for helper          │
└────────────┬────────────────────┘
             │ HTTP (localhost:8443)
┌────────────▼────────────────────┐
│  Agent Helper (User Session)    │
│  - System tray icon             │
│  - Desktop notifications        │
│  - Status display               │
└─────────────────────────────────┘
```

## Installation

The helper is automatically installed with the main agent and configured to run at user login.

### macOS
- Location: `/usr/local/bin/allow2automate-agent-helper`
- Autostart: `/Library/LaunchAgents/com.allow2.agent-helper.plist`

### Linux
- Location: `/usr/local/bin/allow2automate-agent-helper`
- Autostart: `/etc/xdg/autostart/allow2-agent-helper.desktop`

### Windows
- Location: `C:\Program Files\Allow2\agent\helper\allow2automate-agent-helper.exe`
- Autostart: Startup folder shortcut (`allow2automate-agent-helper.lnk`)

## Dependencies

- **node-notifier** (^10.0.1) - Cross-platform desktop notifications
- **systray** (^1.0.5) - System tray icon support
- **node-fetch** (^3.3.0) - HTTP client for API communication

## Features

### System Tray Icon

**Status Indicators:**
- 🟢 **Green**: Connected to parent server
- 🟡 **Yellow**: Agent running, parent disconnected
- 🔴 **Red**: Agent service not running

**Menu Options:**
- **Status**: View current agent and connection status
- **View Issues**: See detailed error messages and resolutions
- **About**: Version and license information
- **Quit**: Exit helper (agent service continues running)

### Notifications

**Automatic notifications for:**
- Agent service stopped/started
- Parent connection lost/restored
- Configuration errors
- Policy violations (future)
- Time warnings (future)

### Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run start:dev

# Build binaries
npm run build:all

# Test on current platform
npm start
```

## Configuration

Environment variables:

- `AGENT_SERVICE_URL`: URL of main agent service (default: `http://localhost:8443`)
- `CHECK_INTERVAL`: Status check interval in ms (default: `10000`)
- `NODE_ENV`: Set to `development` for verbose logging

## Troubleshooting

**Helper not showing in tray:**
- Ensure the helper process is running: `ps aux | grep allow2automate-agent-helper`
- Check helper logs (location varies by platform)
- Restart the helper or re-login

**Notifications not appearing:**
- Check OS notification settings/permissions
- Verify Do Not Disturb mode is off
- Ensure node-notifier is installed

**Agent shows as disconnected:**
- Verify main agent service is running
- Check firewall isn't blocking localhost:8443
- Review main agent logs for errors

## API Endpoints

The helper communicates with these agent endpoints:

- `GET /api/helper/status` - Get current agent status
- `POST /api/helper/command` - Send command to agent (future)

## License

MIT License - Copyright © 2026 Allow2
