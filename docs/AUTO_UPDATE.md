# Agent Auto-Update Design

## Overview

The agent auto-update system enables seamless updates of deployed agents through parent-coordinated downloads and installations. Parents check for new versions, notify agents, and serve installers. Agents download, verify, install, and restart automatically.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Update Flow Overview                          │
└─────────────────────────────────────────────────────────────────┘

1. Parent checks GitHub for new agent releases (every 24h)
2. Parent compares connected agents' versions vs latest
3. If newer version available:
   ├─ Auto-update enabled → Notify agent automatically
   └─ Manual update → Show "Update" button in UI
4. Agent receives update notification with URL
5. Agent downloads installer from parent
6. Agent verifies checksum
7. Agent spawns installer process with update flag
8. Installer updates files
9. Installer restarts agent service
10. New agent starts, reports new version to parent
```

---

## Components

### 1. Parent: Version Discovery

**File:** `app/services/AgentUpdateService.js` (EXISTING - ENHANCE)

**Current Capabilities:**
- Checks GitHub for releases
- Caches installers locally
- Serves installers via HTTP

**Enhancements Needed:**

```javascript
class AgentUpdateService {
  /**
   * Check if agent needs update
   */
  async checkAgentVersion(agentId, currentVersion) {
    const agent = await this.agentService.getAgent(agentId);
    if (!agent) return null;

    // Determine platform
    const platform = agent.platform;

    // Get latest version for platform
    const latestVersion = this.latestVersions[platform]?.version;

    if (!latestVersion) {
      return { needsUpdate: false, reason: 'no_release_available' };
    }

    // Compare versions
    if (this.compareVersions(currentVersion, latestVersion) < 0) {
      return {
        needsUpdate: true,
        currentVersion,
        latestVersion,
        platform,
        downloadUrl: `/api/agent/installer/${latestVersion}/${platform}`,
        checksum: this.latestVersions[platform].checksum,
        releaseNotes: this.latestVersions[platform].releaseNotes
      };
    }

    return { needsUpdate: false };
  }

  /**
   * Get update preference for agent
   */
  async getUpdatePreference(agentId) {
    const agent = await this.agentService.getAgent(agentId);

    // Check agent-specific preference first
    if (agent.auto_update_enabled !== null) {
      return agent.auto_update_enabled;
    }

    // Fall back to global preference
    const globalPref = await this.db.queryOne(
      'SELECT auto_update_enabled FROM settings WHERE key = ?',
      ['global_agent_auto_update']
    );

    return globalPref?.auto_update_enabled || false;
  }

  /**
   * Compare semantic versions
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    return 0;
  }
}
```

### 2. Parent: Update Notification

**File:** `app/routes/agent.js` (ENHANCE)

```javascript
/**
 * Check for agent updates
 * POST /api/agent/check-update
 * Headers: X-Agent-Version: 1.0.0
 * Body: { agentId, currentVersion }
 */
router.post('/api/agent/check-update', authenticateAgent, async (req, res) => {
  try {
    const { currentVersion } = req.body;
    const agentId = req.agentId; // From JWT

    const updateService = global.services.agentUpdate;
    const updateInfo = await updateService.checkAgentVersion(agentId, currentVersion);

    if (!updateInfo.needsUpdate) {
      return res.json({
        updateAvailable: false,
        currentVersion
      });
    }

    // Check update preference
    const autoUpdateEnabled = await updateService.getUpdatePreference(agentId);

    res.json({
      updateAvailable: true,
      currentVersion: updateInfo.currentVersion,
      latestVersion: updateInfo.latestVersion,
      downloadUrl: updateInfo.downloadUrl,
      checksum: updateInfo.checksum,
      releaseNotes: updateInfo.releaseNotes,
      autoUpdate: autoUpdateEnabled,
      mandatory: false // Future: force critical security updates
    });

  } catch (error) {
    console.error('[AgentRoutes] Update check error:', error);
    res.status(500).json({ error: error.message });
  }
});
```

### 3. Parent: Trigger Manual Update

**File:** `app/actions/agent.js` (NEW)

```javascript
/**
 * Trigger agent update (manual or automatic)
 */
export function triggerAgentUpdate(agentId) {
  return async (dispatch, getState) => {
    try {
      dispatch({ type: 'AGENT_UPDATE_REQUESTED', agentId });

      // Set update flag in database
      await global.services.database.query(
        'UPDATE agents SET pending_update = 1 WHERE id = ?',
        [agentId]
      );

      // Agent will check and download on next heartbeat
      dispatch({
        type: 'AGENT_UPDATE_SCHEDULED',
        agentId,
        message: 'Update will be applied on next agent check-in'
      });

    } catch (error) {
      dispatch({
        type: 'AGENT_UPDATE_FAILED',
        agentId,
        error: error.message
      });
    }
  };
}
```

### 4. Agent: Update Check & Download

**File:** `src/AutoUpdater.js` (EXISTING - ENHANCE)

**Current State:** Placeholder implementation

**Enhanced Implementation:**

```javascript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import fetch from 'node-fetch';

export default class AutoUpdater {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.checkTimer = null;
    this.updateInProgress = false;
    this.currentVersion = '1.0.0'; // Read from package.json
  }

  /**
   * Start auto-update checking
   */
  startAutoCheck() {
    // Check for updates every 6 hours
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, 6 * 60 * 60 * 1000);

    // Initial check after 30 seconds
    setTimeout(() => this.checkForUpdates(), 30000);

    this.logger.info('Auto-update checking started');
  }

  /**
   * Stop auto-update checking
   */
  stopAutoCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Check for updates from parent
   */
  async checkForUpdates() {
    if (this.updateInProgress) {
      this.logger.debug('Update already in progress, skipping check');
      return;
    }

    try {
      const authToken = this.configManager.get('authToken');
      const agentId = this.configManager.get('agentId');

      if (!authToken || !agentId) {
        this.logger.warn('Cannot check for updates: not configured');
        return;
      }

      // Get parent connection
      const parentConnection = await this.getParentConnection();
      if (!parentConnection) {
        this.logger.debug('Cannot check updates: parent not reachable');
        return;
      }

      const parentUrl = `http://${parentConnection.host}:${parentConnection.port}`;

      // Request update check
      const response = await fetch(`${parentUrl}/api/agent/check-update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'X-Agent-Version': this.currentVersion
        },
        body: JSON.stringify({
          agentId,
          currentVersion: this.currentVersion
        })
      });

      if (!response.ok) {
        throw new Error(`Update check failed: ${response.status}`);
      }

      const updateInfo = await response.json();

      if (updateInfo.updateAvailable) {
        this.logger.info('Update available', {
          current: updateInfo.currentVersion,
          latest: updateInfo.latestVersion
        });

        // Check if auto-update is enabled
        if (updateInfo.autoUpdate || this.configManager.get('autoUpdate')) {
          await this.downloadAndInstallUpdate(parentUrl, updateInfo);
        } else {
          this.logger.info('Update available but auto-update disabled');
          // Update will be triggered manually from parent UI
        }
      }

    } catch (error) {
      this.logger.error('Update check failed', { error: error.message });
    }
  }

  /**
   * Download and install update
   */
  async downloadAndInstallUpdate(parentUrl, updateInfo) {
    try {
      this.updateInProgress = true;
      this.logger.info('Starting update download', {
        version: updateInfo.latestVersion
      });

      // Prepare download location
      const platform = process.platform;
      const tempDir = this.getTempDirectory();
      const installerExt = this.getInstallerExtension(platform);
      const installerPath = path.join(
        tempDir,
        `allow2automate-agent-update-${updateInfo.latestVersion}${installerExt}`
      );

      // Download installer
      const downloadUrl = `${parentUrl}${updateInfo.downloadUrl}`;
      this.logger.info('Downloading installer', { url: downloadUrl });

      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${this.configManager.get('authToken')}`
        }
      });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      // Save to disk
      const buffer = await response.buffer();
      fs.writeFileSync(installerPath, buffer);

      this.logger.info('Installer downloaded', {
        path: installerPath,
        size: buffer.length
      });

      // Verify checksum
      if (updateInfo.checksum) {
        const actualChecksum = this.calculateChecksum(installerPath);
        if (actualChecksum !== updateInfo.checksum) {
          throw new Error('Checksum verification failed - download corrupted');
        }
        this.logger.info('✅ Checksum verified');
      }

      // Make installer executable (macOS/Linux)
      if (platform !== 'win32') {
        fs.chmodSync(installerPath, 0o755);
      }

      // Run installer
      await this.runInstaller(installerPath, platform);

    } catch (error) {
      this.logger.error('Update installation failed', {
        error: error.message
      });
      this.updateInProgress = false;
      throw error;
    }
  }

  /**
   * Run platform-specific installer
   */
  async runInstaller(installerPath, platform) {
    this.logger.info('Launching installer', { platform, path: installerPath });

    return new Promise((resolve, reject) => {
      let installerProcess;

      switch (platform) {
        case 'win32':
          // Windows: Run .exe with /SILENT /UPDATE flags
          installerProcess = spawn(installerPath, ['/SILENT', '/UPDATE'], {
            detached: true,
            stdio: 'ignore'
          });
          break;

        case 'darwin':
          // macOS: Run .pkg with installer command
          installerProcess = spawn('installer', [
            '-pkg', installerPath,
            '-target', '/',
            '-verboseR'
          ], {
            detached: true,
            stdio: 'ignore'
          });
          break;

        default:
          // Linux: Run .deb/.rpm with appropriate package manager
          const isSudo = process.getuid && process.getuid() === 0;
          if (!isSudo) {
            reject(new Error('Update requires root privileges'));
            return;
          }

          if (installerPath.endsWith('.deb')) {
            installerProcess = spawn('dpkg', ['-i', installerPath], {
              detached: true,
              stdio: 'ignore'
            });
          } else {
            installerProcess = spawn('rpm', ['-U', installerPath], {
              detached: true,
              stdio: 'ignore'
            });
          }
          break;
      }

      // Detach process
      installerProcess.unref();

      this.logger.info('Installer launched, agent will restart shortly');

      // Give installer time to start, then exit
      setTimeout(() => {
        this.logger.info('Exiting for update...');
        process.exit(0); // Installer will restart agent service
      }, 2000);

      resolve();
    });
  }

  /**
   * Calculate file checksum
   */
  calculateChecksum(filePath) {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Get platform-specific temp directory
   */
  getTempDirectory() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return process.env.TEMP || 'C:\\Temp';
      case 'darwin':
        return '/tmp';
      default:
        return '/tmp';
    }
  }

  /**
   * Get installer file extension
   */
  getInstallerExtension(platform) {
    switch (platform) {
      case 'win32':
        return '.exe';
      case 'darwin':
        return '.pkg';
      default:
        return '.deb'; // or .rpm based on distro
    }
  }

  /**
   * Get parent connection helper
   */
  async getParentConnection() {
    // This would use PolicyEngine's discovery logic
    // For now, use configured host/port
    const host = this.configManager.get('host');
    const port = this.configManager.get('port');

    if (host && port) {
      return { host, port };
    }

    return null;
  }
}
```

### 5. Agent Version Reporting

**File:** `src/PolicyEngine.js` (ENHANCE)

```javascript
/**
 * Sync policies from parent API
 */
async syncFromParent() {
  try {
    // ... existing connection code ...

    const response = await fetch(`${parentApiUrl}/api/agents/${agentId}/policies`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        'X-Agent-Version': '1.0.0', // ← ADD: Report version on all requests
        'X-Agent-Platform': process.platform
      }
    });

    // ... rest of sync ...
  }
}

/**
 * Report violation with version header
 */
async reportViolation(policy, processInfo) {
  const response = await fetch(`${parentApiUrl}/api/violations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'X-Agent-Version': '1.0.0', // ← ADD: Report version
      'X-Agent-Platform': process.platform
    },
    body: JSON.stringify(violation)
  });
}
```

### 6. Parent: Track Agent Versions

**File:** `app/services/AgentService.js` (ENHANCE)

```javascript
/**
 * Update heartbeat with version tracking
 */
async updateHeartbeat(agentId, metadata = {}, headers = {}) {
  try {
    // Extract version from headers
    const version = headers['x-agent-version'] || metadata.version;
    const platform = headers['x-agent-platform'] || metadata.platform;

    await this.db.query(`
      UPDATE agents
      SET last_heartbeat = NOW(),
          version = COALESCE($1, version),
          platform = COALESCE($2, platform)
      WHERE id = $3
    `, [version, platform, agentId]);

    // Update last known IP if provided
    if (metadata.ip) {
      await this.db.query(
        'UPDATE agents SET last_known_ip = $1 WHERE id = $2',
        [metadata.ip, agentId]
      );

      const connection = this.agents.get(agentId);
      if (connection) {
        connection.lastKnownIP = metadata.ip;
      }
    }
  } catch (error) {
    console.error('[AgentService] Error updating heartbeat:', error);
  }
}
```

### 7. Parent: UI Update Button with Progress Tracking

**File:** `app/components/AgentSettings.js` (NEW COMPONENT)

```jsx
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { triggerAgentUpdate } from '../actions/agent';

class AgentSettings extends Component {
  handleUpdate = () => {
    const { agent, triggerAgentUpdate } = this.props;
    if (window.confirm(`Update agent ${agent.hostname} to latest version?`)) {
      triggerAgentUpdate(agent.id);
    }
  };

  handleRetryUpdate = () => {
    const { agent, triggerAgentUpdate } = this.props;
    triggerAgentUpdate(agent.id);
  };

  renderUpdateStatus() {
    const { agent } = this.props;

    if (!agent.update_status) {
      return null;
    }

    const { status, step, error, startedAt } = agent.update_status;

    // Map update steps to user-friendly messages
    const stepMessages = {
      'notifying': 'Notifying agent...',
      'downloading': 'Supplying installer...',
      'installing': 'Installing update...',
      'restarting': 'Restarting agent service...'
    };

    switch (status) {
      case 'in_progress':
        return (
          <div className="update-progress">
            <div className="spinner" />
            <span className="status-text">{stepMessages[step] || 'Updating...'}</span>
          </div>
        );

      case 'failed':
        return (
          <div className="update-failed">
            <span className="status-icon">⚠️</span>
            <span className="status-text">
              Failed{' '}
              {error && (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    this.props.showUpdateError(agent.id, error);
                  }}
                  className="error-link"
                >
                  (view diagnostics)
                </a>
              )}
            </span>
            <button
              onClick={this.handleRetryUpdate}
              className="retry-button"
            >
              Retry
            </button>
          </div>
        );

      case 'success':
        return (
          <div className="update-success">
            <span className="status-icon">✅</span>
            <span className="status-text">Updated successfully</span>
          </div>
        );

      default:
        return null;
    }
  }

  render() {
    const { agent, latestVersion } = this.props;

    const needsUpdate = agent.version &&
      latestVersion &&
      compareVersions(agent.version, latestVersion) < 0;

    const isUpdating = agent.update_status?.status === 'in_progress';

    return (
      <div className="agent-settings">
        <h3>{agent.hostname}</h3>
        <div className="version-info">
          <p>Current Version: {agent.version || 'Unknown'}</p>
          <p>Latest Version: {latestVersion || 'Checking...'}</p>

          {this.renderUpdateStatus()}

          {needsUpdate && !isUpdating && !agent.update_status && (
            <button
              onClick={this.handleUpdate}
              className="update-button"
            >
              Update to {latestVersion}
            </button>
          )}

          {!needsUpdate && agent.version && !agent.update_status && (
            <span className="up-to-date">✅ Up to date</span>
          )}
        </div>

        <div className="auto-update-setting">
          <label>
            <input
              type="checkbox"
              checked={agent.auto_update_enabled}
              onChange={this.handleAutoUpdateToggle}
              disabled={isUpdating}
            />
            Enable automatic updates
          </label>
        </div>
      </div>
    );
  }
}

export default connect(
  (state, props) => ({
    latestVersion: state.agentUpdates.latestVersion,
    agent: state.agents.byId[props.agentId]
  }),
  { triggerAgentUpdate }
)(AgentSettings);
```

### Update Progress Bar (Alternative to Spinner)

**File:** `app/components/UpdateProgressBar.js` (NEW COMPONENT)

```jsx
import React from 'react';

const UPDATE_STEPS = [
  { key: 'notifying', label: 'Notifying agent', progress: 25 },
  { key: 'downloading', label: 'Supplying installer', progress: 50 },
  { key: 'installing', label: 'Installing', progress: 75 },
  { key: 'restarting', label: 'Restarting service', progress: 90 }
];

export default function UpdateProgressBar({ currentStep, status }) {
  const step = UPDATE_STEPS.find(s => s.key === currentStep) || UPDATE_STEPS[0];

  return (
    <div className="update-progress-bar">
      <div className="progress-container">
        <div
          className="progress-fill"
          style={{ width: `${step.progress}%` }}
        />
      </div>
      <div className="progress-label">
        {status === 'failed' ? (
          <span className="failed-label">❌ Update failed</span>
        ) : (
          <span>{step.label}...</span>
        )}
      </div>
    </div>
  );
}
```

---

## Update Flow Diagrams

### Automatic Update Flow

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│ Parent  │         │  Agent  │         │Installer│
└────┬────┘         └────┬────┘         └────┬────┘
     │                   │                    │
     │ 1. Check GitHub   │                    │
     │ (New version!)    │                    │
     ├──────────────────>│                    │
     │                   │                    │
     │                   │ 2. Check updates   │
     │<──────────────────┤ (heartbeat/poll)   │
     │                   │                    │
     │ 3. Update needed  │                    │
     │    autoUpdate=true│                    │
     ├──────────────────>│                    │
     │                   │                    │
     │ 4. Download URL   │                    │
     ├──────────────────>│                    │
     │                   │                    │
     │ 5. GET /installer │                    │
     │<──────────────────┤                    │
     │                   │                    │
     │ 6. Installer file │                    │
     ├──────────────────>│                    │
     │                   │                    │
     │                   │ 7. Verify checksum │
     │                   │    ✅ Valid        │
     │                   │                    │
     │                   │ 8. Spawn installer │
     │                   ├───────────────────>│
     │                   │                    │
     │                   │ 9. Exit agent      │
     │                   │    process         │
     │                   ×                    │
     │                                        │
     │                              10. Update files
     │                              11. Restart service
     │                                        │
     │                   ┌────────────────────┤
     │                   │ (Agent restarted)  │
     │                   │                    ×
     │                   │
     │ 12. Heartbeat     │
     │     v2.0.0 ✅     │
     │<──────────────────┤
     │                   │
```

### Manual Update Flow

```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│  Parent │   │ Parent  │   │  Agent  │   │Installer│
│   UI    │   │  API    │   │         │   │         │
└────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
     │             │             │             │
     │ 1. Click   │             │             │
     │ "Update"   │             │             │
     │ button     │             │             │
     ├───────────>│             │             │
     │             │             │             │
     │             │ 2. Set flag │             │
     │             │   pending   │             │
     │             │   _update=1 │             │
     │             ├────────────>│             │
     │             │             │             │
     │             │             │ 3. Next     │
     │             │ heartbeat   │             │
     │             │<────────────┤             │
     │             │             │             │
     │             │ 4. Response:│             │
     │             │ update=true │             │
     │             ├────────────>│             │
     │             │             │             │
     │             │             │ ... same as │
     │             │             │ auto update │
     │             │             │ flow ...    │
```

---

## Database Schema Updates

### agents table

```sql
ALTER TABLE agents ADD COLUMN version VARCHAR(20) DEFAULT NULL;
ALTER TABLE agents ADD COLUMN auto_update_enabled BOOLEAN DEFAULT NULL;
  -- NULL = use global setting, TRUE/FALSE = override
ALTER TABLE agents ADD COLUMN pending_update BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN last_update_check DATETIME DEFAULT NULL;
ALTER TABLE agents ADD COLUMN last_update_attempt DATETIME DEFAULT NULL;

-- Update progress tracking
ALTER TABLE agents ADD COLUMN update_status VARCHAR(20) DEFAULT NULL;
  -- in_progress, success, failed, NULL
ALTER TABLE agents ADD COLUMN update_step VARCHAR(50) DEFAULT NULL;
  -- notifying, downloading, installing, restarting
ALTER TABLE agents ADD COLUMN update_started_at DATETIME DEFAULT NULL;
ALTER TABLE agents ADD COLUMN update_error TEXT DEFAULT NULL;
```

### settings table

```sql
INSERT INTO settings (key, value) VALUES
  ('global_agent_auto_update', '{"enabled": false}');
```

### agent_update_history table (NEW)

```sql
CREATE TABLE agent_update_history (
  id VARCHAR(36) PRIMARY KEY,
  agent_id VARCHAR(36) NOT NULL,
  from_version VARCHAR(20),
  to_version VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL, -- pending, success, failed
  initiated_by VARCHAR(20) NOT NULL, -- auto, manual, forced
  started_at DATETIME NOT NULL,
  completed_at DATETIME DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);
```

---

## Configuration

### Parent: Global Settings

```json
{
  "agentUpdates": {
    "enabled": true,
    "checkInterval": 86400000,  // 24 hours
    "autoUpdateByDefault": false,
    "allowManualTrigger": true,
    "releaseChannel": "stable"  // stable, beta, alpha
  }
}
```

### Agent: Auto-Update Settings

```json
{
  "autoUpdate": true,  // Local preference (overridden by parent)
  "updateChannel": "stable",
  "allowPrerelease": false
}
```

---

## Error Handling

### Download Failures

- **Network Error:** Retry up to 3 times with exponential backoff
- **Checksum Mismatch:** Reject update, report to parent
- **Disk Space:** Check before download, fail gracefully

### Installation Failures

- **Permission Error:** Log error, require admin/root privileges
- **Service Restart Failed:** Attempt manual restart, alert parent
- **Rollback:** Keep previous version backup for recovery

### Parent Unavailable During Update

- Agent checks periodically (every 6 hours)
- Updates on next successful connection
- No immediate failure - resilient to temporary outages

---

## Security Considerations

1. **Installer Verification:**
   - SHA256 checksum validation (MUST match)
   - Served only via authenticated parent API
   - Downloaded over secure channel

2. **Privilege Escalation:**
   - Windows: Installer runs with admin privileges
   - macOS: PKG installer requires root
   - Linux: Agent service runs as root

3. **Supply Chain Attack Prevention:**
   - Parent downloads from official GitHub releases only
   - Checksums verified against GitHub release metadata
   - Agent verifies parent authenticity before accepting update

4. **Rollback Protection:**
   - Installer keeps backup of previous version
   - Failed update can be reverted
   - Agent reports failure to parent

---

## Testing Strategy

### Unit Tests

1. **Version Comparison**
   - `1.0.0 < 1.1.0`
   - `1.9.0 < 2.0.0`
   - `1.2.3 == 1.2.3`

2. **Checksum Validation**
   - Valid checksum → accept
   - Invalid checksum → reject

3. **Update Preference Logic**
   - Agent-specific overrides global
   - NULL uses global default

### Integration Tests

1. **End-to-End Update**
   - Parent checks GitHub
   - Agent downloads and installs
   - New agent reports version

2. **Manual Trigger**
   - UI button click
   - Agent receives notification
   - Update proceeds

3. **Failed Update Recovery**
   - Simulate download failure
   - Verify retry logic
   - Verify graceful degradation

### Platform-Specific Tests

1. **Windows**: .exe installer with silent flags
2. **macOS**: .pkg installer with proper permissions
3. **Linux**: .deb installer with dpkg

---

## Performance Considerations

- **Download Size:** 10-50MB per platform
- **Update Time:** 30 seconds - 2 minutes
- **Service Downtime:** < 10 seconds during restart
- **Bandwidth:** Agents download from parent (not GitHub) - LAN speed

---

## Implementation Checklist

**Phase 1: Version Tracking**
- [ ] Add `version` column to agents table
- [ ] Add version reporting to all agent API calls
- [ ] Update parent heartbeat handler to capture version
- [ ] Display agent versions in parent UI

**Phase 2: Update Detection**
- [ ] Enhance `AgentUpdateService` to track latest versions
- [ ] Add `/api/agent/check-update` endpoint
- [ ] Implement version comparison logic
- [ ] Add update preference storage

**Phase 3: Agent Auto-Update**
- [ ] Enhance `AutoUpdater` to check for updates
- [ ] Implement download and verification
- [ ] Add platform-specific installer spawning
- [ ] Test update flow on all platforms

**Phase 4: Manual Updates**
- [ ] Add "Update" button to parent UI
- [ ] Implement `triggerAgentUpdate` action
- [ ] Add pending_update flag to database
- [ ] Test manual update trigger

**Phase 5: Update History**
- [ ] Create `agent_update_history` table
- [ ] Log all update attempts
- [ ] Display update history in UI
- [ ] Add update analytics

**Testing:**
- [ ] Version comparison unit tests
- [ ] Checksum validation tests
- [ ] End-to-end update flow (all platforms)
- [ ] Failed update recovery
- [ ] Manual trigger integration test

---

## Future Enhancements

1. **Staged Rollouts**
   - Update 10% of agents first
   - Monitor for issues
   - Roll out to remaining agents if successful

2. **Update Scheduling**
   - Parent specifies maintenance windows
   - Agent updates only during allowed times
   - Avoid disrupting active use

3. **Differential Updates**
   - Download only changed files (not full installer)
   - Reduces bandwidth and update time
   - Requires binary diffing support

4. **Update Notifications**
   - Parent email notifications on update completion
   - Agent logs sent to parent after update
   - Failure alerts with diagnostic info

5. **Emergency Updates**
   - Critical security patches forced immediately
   - Override user preferences for mandatory updates
   - Compliance with security policies
