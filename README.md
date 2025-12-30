# Allow2 Automate Agent

A cross-platform system service for process monitoring and parental controls. The agent runs as a background service on Windows, macOS, and Linux, monitoring running processes and enforcing policies set by parent applications.

## Features

- **Cross-Platform Support**: Runs on Windows, macOS, and Linux
- **Process Monitoring**: Continuously monitors running processes
- **Policy Enforcement**: Automatically terminates prohibited processes
- **REST API**: HTTPS API for remote management
- **mDNS Discovery**: Automatic discovery by parent applications
- **Auto-Update**: Self-updating mechanism
- **Secure**: JWT authentication, encrypted communications
- **System Service**: Runs as a native system service

## Architecture

```
┌─────────────────────────────────────────┐
│        Allow2 Automate Agent            │
├─────────────────────────────────────────┤
│  ┌──────────────┐  ┌─────────────────┐ │
│  │   API Server │  │ Process Monitor │ │
│  │  (REST/JWT)  │  │  (30s interval) │ │
│  └──────────────┘  └─────────────────┘ │
│  ┌──────────────┐  ┌─────────────────┐ │
│  │ Policy Engine│  │ mDNS Discovery  │ │
│  │ (Sync/Cache) │  │   (Bonjour)     │ │
│  └──────────────┘  └─────────────────┘ │
│  ┌──────────────┐  ┌─────────────────┐ │
│  │ Auto-Updater │  │  Config Manager │ │
│  └──────────────┘  └─────────────────┘ │
├─────────────────────────────────────────┤
│      Platform Abstraction Layer         │
│   (Windows | macOS | Linux)             │
└─────────────────────────────────────────┘
```

## Installation

### Prerequisites

- Node.js >= 18.0.0
- Administrator/root privileges for service installation

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
npm run start:dev
```

### Install as System Service

#### Windows

```bash
npm run build:windows
# Run the generated MSI installer
```

#### macOS

```bash
npm run build:macos
# Install the generated PKG
```

#### Linux

```bash
npm run build:linux
# Install the generated DEB/RPM package
```

## Configuration

The agent stores configuration in platform-specific locations:

- **Windows**: `C:\ProgramData\Allow2\agent\config.json`
- **macOS**: `/Library/Application Support/Allow2/agent/config.json`
- **Linux**: `/etc/allow2/agent/config.json`

### Default Configuration

```json
{
  "apiPort": 8443,
  "checkInterval": 30000,
  "logLevel": "info",
  "enableMDNS": true,
  "autoUpdate": true
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentId` | string | null | Unique agent identifier |
| `parentApiUrl` | string | null | Parent application API URL |
| `authToken` | string | null | JWT authentication token |
| `apiPort` | number | 8443 | API server port |
| `checkInterval` | number | 30000 | Process check interval (ms) |
| `logLevel` | string | "info" | Logging level |
| `enableMDNS` | boolean | true | Enable mDNS advertising |
| `autoUpdate` | boolean | true | Enable auto-updates |

## REST API

The agent exposes a REST API on port 8443 (configurable).

### Authentication

All API endpoints (except `/api/health`, `/api/heartbeat`, and `/api/platform-users`) require JWT authentication:

```
Authorization: Bearer <token>
```

### Endpoints

#### Health Check

```
GET /api/health
```

Returns agent health status and basic information.

#### Heartbeat

```
POST /api/heartbeat
```

Keep-alive endpoint for monitoring.

#### Platform Users

```
GET /api/platform-users
```

Discover local platform users for account linking.

#### Policy Management

Create policy:
```
POST /api/policies
Content-Type: application/json

{
  "id": "policy-123",
  "processName": "game.exe",
  "allowed": false,
  "schedule": {
    "startTime": "14:00",
    "endTime": "16:00",
    "days": [1, 2, 3, 4, 5]
  }
}
```

List policies:
```
GET /api/policies
```

Get policy:
```
GET /api/policies/:id
```

Update policy:
```
PATCH /api/policies/:id
Content-Type: application/json

{
  "allowed": true
}
```

Delete policy:
```
DELETE /api/policies/:id
```

#### Sync with Parent

```
POST /api/sync
```

Trigger policy synchronization with parent API.

#### Configuration

Get configuration:
```
GET /api/config
```

Update configuration:
```
PATCH /api/config
Content-Type: application/json

{
  "checkInterval": 60000,
  "logLevel": "debug"
}
```

#### Process Monitoring

Get monitor status:
```
GET /api/monitor/status
```

Start monitoring:
```
POST /api/monitor/start
```

Stop monitoring:
```
POST /api/monitor/stop
```

#### Process List

```
GET /api/processes
```

Returns list of currently running processes.

#### Auto-Update

```
POST /api/update
Content-Type: application/json

{
  "version": "1.1.0",
  "downloadUrl": "/downloads/agent-1.1.0.msi"
}
```

## mDNS Discovery

The agent advertises itself via mDNS/Bonjour for automatic discovery:

- **Service Type**: `_allow2._tcp`
- **Service Name**: `allow2-agent-{hostname}`
- **TXT Records**:
  - `agentId`: Unique agent identifier
  - `hostname`: System hostname
  - `version`: Agent version
  - `platform`: Operating system platform
  - `arch`: System architecture

## Process Monitoring

The agent monitors processes at regular intervals (default: 30 seconds) and:

1. Fetches active policies from the policy engine
2. Checks if prohibited processes are running
3. Terminates any prohibited processes
4. Reports violations to parent API
5. Enforces time-based schedules and quotas

### Policy Structure

```javascript
{
  id: "policy-123",
  processName: "game.exe",
  allowed: false,
  schedule: {
    startTime: "14:00",  // 2:00 PM
    endTime: "16:00",    // 4:00 PM
    days: [1, 2, 3, 4, 5] // Monday-Friday (0=Sunday)
  },
  quotas: {
    dailyMinutes: 120  // 2 hours per day (future)
  }
}
```

## Development

### Project Structure

```
allow2automate-agent/
├── src/
│   ├── index.js              # Main entry point
│   ├── ApiServer.js          # REST API server
│   ├── ProcessMonitor.js     # Process monitoring
│   ├── PolicyEngine.js       # Policy management
│   ├── ConfigManager.js      # Configuration
│   ├── DiscoveryAdvertiser.js # mDNS advertising
│   ├── AutoUpdater.js        # Auto-update
│   ├── Logger.js             # Logging utility
│   └── platform/
│       ├── windows.js        # Windows implementation
│       ├── darwin.js         # macOS implementation
│       └── linux.js          # Linux implementation
├── tests/
│   ├── ConfigManager.test.js
│   ├── PolicyEngine.test.js
│   ├── ProcessMonitor.test.js
│   └── platform/
│       ├── windows.test.js
│       ├── darwin.test.js
│       └── linux.test.js
├── config/
│   └── default.json
├── installers/
│   ├── windows/
│   ├── macos/
│   └── linux/
├── scripts/
└── package.json
```

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Code Style

```bash
# Lint code
npm run lint
```

## Platform-Specific Implementation

Each platform has its own implementation for process management:

### Windows

- Uses `tasklist` to check running processes
- Uses `taskkill /F` to terminate processes
- Processes identified by executable name (e.g., `chrome.exe`)

### macOS

- Uses `pgrep` to check running processes
- Uses `pkill -9` to terminate processes
- Processes identified by app name (case-insensitive)

### Linux

- Uses `pgrep` to check running processes
- Uses `pkill -9` to terminate processes
- Similar to macOS implementation

## Security

- **JWT Authentication**: All API endpoints require valid JWT tokens
- **Secure Storage**: Configuration files have restricted permissions (0600)
- **HTTPS**: API server uses HTTPS (certificates configurable)
- **Token Rotation**: Support for token refresh
- **Rate Limiting**: Violation reports are rate-limited

## Logging

Logs are stored in platform-specific locations:

- **Windows**: `C:\ProgramData\Allow2\agent\logs\`
- **macOS**: `/Library/Logs/Allow2/agent/`
- **Linux**: `/var/log/allow2/agent/`

Log files:
- `agent.log` - General application logs
- `error.log` - Error logs only

Log rotation:
- Maximum file size: 10 MB
- Maximum files: 5

## Troubleshooting

### Agent Not Starting

1. Check logs in the platform-specific log directory
2. Verify Node.js version >= 18.0.0
3. Ensure proper permissions (run as admin/root)
4. Check if port 8443 is available

### Process Not Being Terminated

1. Check if policy is active (schedule, days)
2. Verify process name matches exactly
3. Check agent has sufficient privileges
4. Review logs for error messages

### mDNS Not Working

1. Ensure `enableMDNS` is true in config
2. Check firewall allows mDNS (port 5353)
3. Verify network supports multicast
4. Check Bonjour/Avahi service is running

### API Not Accessible

1. Check agent is running
2. Verify port is not blocked by firewall
3. Ensure proper authentication token
4. Check SSL/TLS certificate configuration

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [github.com/allow2/allow2automate-agent](https://github.com/allow2/allow2automate-agent)
- Documentation: [docs.allow2.com](https://docs.allow2.com)
