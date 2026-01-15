# Plugin Extensions & Agent Communication Design

## Overview

The agent deployment system extends the reach of the parent application and its plugins to remote machines. The agent itself is a lightweight communication platform focused on connectivity, health monitoring, and basic system reporting. **All application-specific functionality is provided by plugins** that can deploy custom data monitors and action scripts to agents.

---

## Core Principles

### 1. Agent as Communication Platform

The agent's **sole responsibility** is to:
- Maintain secure connection to parent
- Report health/connectivity status
- Manage version updates
- Provide basic system information:
  - Heartbeat (keepalive)
  - Currently logged-in user(s) / active sessions
  - Process list (platform-dependent)
  - Machine health/stats (CPU, memory, disk - platform-dependent)

**The agent does NOT:**
- Enforce policies directly (plugins do this)
- Contain application logic (plugins provide this)
- Make control decisions (parent-side plugins decide)

### 2. Plugins Provide All Functionality

Plugins extend agents with application-specific capabilities through:
1. **Data Monitor Scripts** - Deployed to agents to collect data
2. **Action Scripts** - Deployed to agents to execute commands
3. **Parent-Side Logic** - Processes collected data and makes decisions

### 3. Resilient Communication Design

- **Opportunistic data forwarding** - Connection interruptions don't lose data
- **Batch operations** - Multiple operations grouped to reduce overhead
- **Debounce responses** - Multiple responses in ~2 seconds sent as batch
- **Queue-based architecture** - Messages cached when offline, sent when online

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        Parent Application                       │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Plugin A    │  │  Plugin B    │  │  Plugin C    │         │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤         │
│  │ Monitor Logic│  │ Monitor Logic│  │ Monitor Logic│         │
│  │ - Receives   │  │ - Receives   │  │ - Receives   │         │
│  │   data       │  │   data       │  │   data       │         │
│  │ - Makes      │  │ - Makes      │  │ - Makes      │         │
│  │   decisions  │  │   decisions  │  │   decisions  │         │
│  │              │  │              │  │              │         │
│  │ Action Defs  │  │ Action Defs  │  │ Action Defs  │         │
│  │ - Script code│  │ - Script code│  │ - Script code│         │
│  │ - Trigger    │  │ - Trigger    │  │ - Trigger    │         │
│  │   with args  │  │   with args  │  │   with args  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│           │                 │                 │                │
│           └─────────────────┴─────────────────┘                │
│                             │                                  │
│                    Plugin Manager                              │
│                   (Deploy, Trigger, Collect)                   │
│                             │                                  │
└─────────────────────────────┼──────────────────────────────────┘
                              │ Secure Agent API
                              │ (mDNS + Trust)
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                     Agent (Remote Machine)                      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │           Plugin Extension Manager                      │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │                                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │ Plugin A     │  │ Plugin B     │  │ Plugin C     │ │   │
│  │  │ Monitor      │  │ Monitor      │  │ Monitor      │ │   │
│  │  ├──────────────┤  ├──────────────┤  ├──────────────┤ │   │
│  │  │ Script       │  │ Script       │  │ Script       │ │   │
│  │  │ (sandboxed)  │  │ (sandboxed)  │  │ (sandboxed)  │ │   │
│  │  │              │  │              │  │              │ │   │
│  │  │ Runs @       │  │ Runs @       │  │ Runs @       │ │   │
│  │  │ interval     │  │ interval     │  │ interval     │ │   │
│  │  │              │  │              │  │              │ │   │
│  │  │ Collects:    │  │ Collects:    │  │ Collects:    │ │   │
│  │  │ - Pipe check │  │ - DB query   │  │ - Log parse  │ │   │
│  │  │ - User info  │  │ - Registry   │  │ - File check │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │   │
│  │                                                         │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│  │  │ Plugin A     │  │ Plugin B     │  │ Plugin C     │ │   │
│  │  │ Actions      │  │ Actions      │  │ Actions      │ │   │
│  │  ├──────────────┤  ├──────────────┤  ├──────────────┤ │   │
│  │  │ Script       │  │ Script       │  │ Script       │ │   │
│  │  │ (sandboxed)  │  │ (sandboxed)  │  │ (sandboxed)  │ │   │
│  │  │              │  │              │  │              │ │   │
│  │  │ Triggered by │  │ Triggered by │  │ Triggered by │ │   │
│  │  │ parent with  │  │ parent with  │  │ parent with  │ │   │
│  │  │ arguments    │  │ arguments    │  │ arguments    │ │   │
│  │  │              │  │              │  │              │ │   │
│  │  │ Executes:    │  │ Executes:    │  │ Executes:    │ │   │
│  │  │ - Kill proc  │  │ - Toast msg  │  │ - Lock screen│ │   │
│  │  │ - Block URL  │  │ - Warn user  │  │ - Logout     │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │   │
│  │                                                         │   │
│  │  Data Queue (offline-resilient)                        │   │
│  │  Action Queue (debounced batching)                     │   │
│  └────────────────────────────────────────────────────────┘   │
│                             │                                  │
│  Core Agent                 │                                  │
│  - Connectivity             │                                  │
│  - Health                   │                                  │
│  - Updates                  │                                  │
│  - System Info              │                                  │
│                             │                                  │
└─────────────────────────────┼──────────────────────────────────┘
                              │ Heartbeat / Sync
                              ▼
```

---

## Plugin Data Monitor System

### Data Monitor Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Plugin Deployment                                         │
├─────────────────────────────────────────────────────────────┤
│ Parent → Agent: Deploy monitor script for "Plugin A"        │
│                                                              │
│ {                                                            │
│   "pluginId": "game-monitor-v1",                            │
│   "monitorId": "steam-user-tracker",                        │
│   "script": "base64-encoded-script-code",                   │
│   "interval": 30000,  // Run every 30 seconds               │
│   "platform": ["win32", "darwin"],  // Supported platforms  │
│   "checksum": "sha256-hash"                                  │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Agent Receives & Caches                                   │
├─────────────────────────────────────────────────────────────┤
│ - Verify checksum                                            │
│ - Save to: /var/lib/allow2/plugins/{pluginId}/monitors/     │
│ - Start execution at specified interval                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. Monitor Execution (Every interval)                        │
├─────────────────────────────────────────────────────────────┤
│ - Run script in sandboxed environment                        │
│ - Script checks:                                             │
│   • Named pipe existence                                     │
│   • Local database value                                     │
│   • Log file entry                                           │
│   • Registry key (Windows)                                   │
│   • Process list                                             │
│   • File system state                                        │
│                                                              │
│ - Script returns JSON:                                       │
│   {                                                          │
│     "timestamp": 1234567890,                                 │
│     "currentUser": "bobby",                                  │
│     "gameActive": true,                                      │
│     "playtime": 1234  // seconds                             │
│   }                                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 4. Data Collection & Queuing                                 │
├─────────────────────────────────────────────────────────────┤
│ - Data cached to: /var/lib/allow2/data-queue/               │
│ - Keyed by: {pluginId}/{monitorId}                          │
│ - Queue survives agent restarts                              │
│ - Queue synced opportunistically                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 5. Data Sync (Next Heartbeat / Connection)                   │
├─────────────────────────────────────────────────────────────┤
│ Agent → Parent: Batch sync                                   │
│                                                              │
│ POST /api/agent/plugin-data                                  │
│ {                                                            │
│   "agentId": "abc-123",                                      │
│   "pluginData": {                                            │
│     "game-monitor-v1": {                                     │
│       "steam-user-tracker": [                                │
│         { "timestamp": ..., "currentUser": "bobby", ... },   │
│         { "timestamp": ..., "currentUser": "bobby", ... }    │
│       ]                                                      │
│     }                                                        │
│   }                                                          │
│ }                                                            │
│                                                              │
│ - Parent receives data                                       │
│ - Parent triggers plugin monitor logic                       │
│ - Queue entries cleared on successful delivery               │
└─────────────────────────────────────────────────────────────┘
```

### Monitor Script Example (JavaScript)

**Parent-Side Plugin Definition:**

```javascript
// Plugin: game-monitor-v1
// File: plugins/game-monitor/monitors/steam-user.js

module.exports = {
  id: 'steam-user-tracker',
  interval: 30000, // 30 seconds
  platforms: ['win32', 'darwin'],

  // This script is deployed to the agent
  script: function() {
    const fs = require('fs');
    const os = require('os');

    function getSteamUser() {
      // Check if Steam is running and get current user
      // Platform-specific logic...

      if (process.platform === 'win32') {
        // Check named pipe: \\.\pipe\Steam\SteamClient
        // Or check registry for logged in user
        return checkWindowsSteam();
      } else if (process.platform === 'darwin') {
        // Check ~/Library/Application Support/Steam/config/loginusers.vdf
        return checkMacOSSteam();
      }

      return null;
    }

    function checkGameActivity() {
      // Parse Steam log or check process list
      // Return active game if any
    }

    // Return data to be sent back to parent
    return {
      timestamp: Date.now(),
      hostname: os.hostname(),
      systemUser: os.userInfo().username,
      steamUser: getSteamUser(),
      gameActive: checkGameActivity(),
      playtime: getSessionPlaytime()
    };
  }
};
```

**Agent Execution:**

```javascript
// Agent: src/PluginExtensionManager.js
class PluginExtensionManager {
  async executeMonitor(pluginId, monitorId) {
    try {
      const monitor = this.monitors.get(`${pluginId}:${monitorId}`);

      // Execute script in sandboxed VM
      const result = await this.sandbox.execute(monitor.script, {
        timeout: 5000,
        memory: '128MB'
      });

      // Cache result
      await this.queueData(pluginId, monitorId, result);

    } catch (error) {
      this.logger.error('Monitor execution failed', {
        pluginId,
        monitorId,
        error: error.message
      });

      // Queue error for reporting
      await this.queueError(pluginId, monitorId, error);
    }
  }
}
```

---

## Plugin Action System

### Action Script Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Plugin Action Definition (One-Time Deployment)            │
├─────────────────────────────────────────────────────────────┤
│ Parent → Agent: Deploy action script for "Plugin A"         │
│                                                              │
│ {                                                            │
│   "pluginId": "game-monitor-v1",                            │
│   "actionId": "terminate-game",                             │
│   "script": "base64-encoded-script-code",                   │
│   "platform": ["win32", "darwin"],                          │
│   "checksum": "sha256-hash"                                  │
│ }                                                            │
│                                                              │
│ - Agent caches script to disk                                │
│ - Script persists across restarts                            │
│ - Only re-deployed when updated                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Parent-Side Decision                                      │
├─────────────────────────────────────────────────────────────┤
│ Plugin Monitor receives data:                                │
│ - Child "bobby" played 2 hours today                         │
│ - Quota: 1 hour/day                                          │
│ - Decision: Terminate game process                           │
│                                                              │
│ Plugin triggers action:                                      │
│ pluginManager.triggerAction('game-monitor-v1',               │
│   'terminate-game', agentId, {                               │
│     processName: 'Steam.exe',                                │
│     shutdownTime: Date.now() + (5 * 60 * 1000), // 5 min    │
│     warningMessage: 'Time limit reached'                     │
│   });                                                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. Action Queueing                                           │
├─────────────────────────────────────────────────────────────┤
│ Parent stores action trigger in database:                    │
│                                                              │
│ INSERT INTO plugin_action_queue (                            │
│   agent_id, plugin_id, action_id,                           │
│   arguments, triggered_at, status                            │
│ ) VALUES (                                                   │
│   'abc-123', 'game-monitor-v1', 'terminate-game',           │
│   '{"processName":"Steam.exe",...}',                         │
│   NOW(), 'pending'                                           │
│ );                                                           │
│                                                              │
│ - Action waits for next agent heartbeat                      │
│ - Multiple actions accumulated if triggered quickly          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 4. Agent Heartbeat Collects Actions                          │
├─────────────────────────────────────────────────────────────┤
│ POST /api/agent/heartbeat                                    │
│                                                              │
│ Response:                                                    │
│ {                                                            │
│   "success": true,                                           │
│   "pendingActions": [                                        │
│     {                                                        │
│       "pluginId": "game-monitor-v1",                         │
│       "actionId": "terminate-game",                          │
│       "triggerId": "action-uuid-123",                        │
│       "arguments": {                                         │
│         "processName": "Steam.exe",                          │
│         "shutdownTime": 1234567890,                          │
│         "warningMessage": "Time limit reached"               │
│       }                                                      │
│     }                                                        │
│   ]                                                          │
│ }                                                            │
│                                                              │
│ - Agent receives all pending actions                         │
│ - Parent marks actions as 'delivered'                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 5. Agent Executes Actions (Asynchronously)                   │
├─────────────────────────────────────────────────────────────┤
│ For each action:                                             │
│ - Load cached action script                                  │
│ - Execute with provided arguments                            │
│ - Capture return code, stdout, stderr                        │
│ - Queue response for parent                                  │
│                                                              │
│ Action execution (sandboxed):                                │
│ {                                                            │
│   "triggerId": "action-uuid-123",                            │
│   "status": "success",                                       │
│   "returnCode": 0,                                           │
│   "output": "Process terminated successfully",               │
│   "error": null,                                             │
│   "executedAt": 1234567890                                   │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 6. Response Batching & Debounce                              │
├─────────────────────────────────────────────────────────────┤
│ - Multiple action responses cached                           │
│ - If responses arrive within ~2 seconds: BATCH               │
│ - Send batched responses on next heartbeat                   │
│                                                              │
│ POST /api/agent/plugin-action-responses                      │
│ {                                                            │
│   "agentId": "abc-123",                                      │
│   "responses": [                                             │
│     { "triggerId": "action-uuid-123", ... },                 │
│     { "triggerId": "action-uuid-456", ... }                  │
│   ]                                                          │
│ }                                                            │
│                                                              │
│ - Parent updates action status in database                   │
│ - Parent-side plugin receives results                        │
└─────────────────────────────────────────────────────────────┘
```

### Action Script Example

**Parent-Side Plugin:**

```javascript
// Plugin: game-monitor-v1
// File: plugins/game-monitor/actions/terminate-game.js

module.exports = {
  id: 'terminate-game',
  platforms: ['win32', 'darwin', 'linux'],

  // This script is deployed to the agent
  script: function(args) {
    const { exec } = require('child_process');
    const os = require('os');
    const { processName, shutdownTime, warningMessage } = args;

    // Show warning toast
    function showWarning() {
      if (process.platform === 'win32') {
        // Use Windows toast notification
        exec(`powershell -Command "New-BurntToastNotification -Text '${warningMessage}'"`);
      } else if (process.platform === 'darwin') {
        // Use macOS notification
        exec(`osascript -e 'display notification "${warningMessage}"'`);
      }
    }

    // Wait until shutdown time
    const waitTime = shutdownTime - Date.now();
    if (waitTime > 0) {
      // Show warning every minute
      const warningInterval = setInterval(showWarning, 60000);

      setTimeout(() => {
        clearInterval(warningInterval);
        terminateProcess();
      }, waitTime);
    } else {
      terminateProcess();
    }

    function terminateProcess() {
      if (process.platform === 'win32') {
        exec(`taskkill /IM "${processName}" /F`, (error, stdout, stderr) => {
          if (error) {
            return { success: false, error: stderr };
          }
          return { success: true, output: stdout };
        });
      } else {
        exec(`pkill -9 "${processName}"`, (error, stdout, stderr) => {
          if (error) {
            return { success: false, error: stderr };
          }
          return { success: true, output: stdout };
        });
      }
    }

    return { success: true, waitTime };
  }
};
```

---

## Dynamic Quota and Limit Management

### Overview

**Critical Design Principle:** Quotas, limits, bans, and allowances are **externally managed** on the Allow2 platform and can change at any time outside of the allow2automate application. Plugins must **never cache or assume** current limits - they must always check with the Allow2 platform for real-time allowances before making enforcement decisions.

### Why Limits Are Dynamic

Parent users can modify limits through multiple channels:
1. **Allow2 Mobile Apps** - iOS/Android apps
2. **Allow2 Web Interface** - Web dashboard
3. **Allow2 API** - Third-party integrations
4. **Other Devices** - Limits adjusted from other installations
5. **Allow2 Platform Rules** - Time-based rules, reward systems, etc.

These changes happen **immediately** and **independently** of the allow2automate parent app or agents.

### Types of Dynamic Changes

| Change Type | Description | Impact on Plugins |
|-------------|-------------|-------------------|
| **Quota Consumption** | Other devices consume quota (e.g., child plays Xbox, gaming quota decreases) | Plugin must check before allowing activity |
| **Quota Adjustment** | Parent increases/decreases daily limit | Remaining time changes immediately |
| **Ban Imposed** | Parent adds immediate ban (e.g., grounded) | Plugin must block activity immediately |
| **Ban Lifted** | Parent removes ban | Plugin must allow activity immediately |
| **Rate Change** | Quota consumption rate changes (e.g., 1x → 2x on weekends) | Time remaining calculates differently |
| **Token Grant** | Parent grants bonus tokens/time | Additional quota available immediately |
| **Activity Block** | Specific activity temporarily blocked | Plugin must prevent that activity |

### Plugin Check Requirements

#### Rule 1: Always Check Before Action

Plugins must **never** rely on cached quota information. Every enforcement decision requires a fresh check with the Allow2 platform.

```javascript
// ❌ WRONG: Using cached quota
class GameMonitorPlugin {
  async enforceQuota(child, process) {
    // Don't do this!
    if (this.cachedQuota[child] <= 0) {
      this.killProcess(process);
    }
  }
}

// ✅ CORRECT: Check with Allow2 platform
class GameMonitorPlugin {
  async enforceQuota(child, process) {
    // Always check current allowance
    const allowance = await this.allow2Client.checkActivity({
      child_id: child.id,
      activity_type: 'gaming',
      log_usage: false  // Just checking, not logging yet
    });

    if (!allowance.allowed || allowance.remaining_seconds <= 0) {
      this.killProcess(process);
    }
  }
}
```

#### Rule 2: Specify Whether to Log Usage

Every check with the Allow2 platform must specify whether it should **consume quota** or just **check availability**.

**Two Types of Checks:**

1. **Check WITHOUT Logging** (`log_usage: false`)
   - Used for: Preview checks, warnings, UI updates
   - Does NOT consume quota
   - Returns current allowance state

2. **Check WITH Logging** (`log_usage: true`)
   - Used for: Recording actual usage
   - DOES consume quota
   - Creates usage log entry

```javascript
// Example: Warning system (check without logging)
async showWarning(child) {
  const allowance = await this.allow2Client.checkActivity({
    child_id: child.id,
    activity_type: 'gaming',
    log_usage: false,  // Don't consume quota
    check_only: true
  });

  if (allowance.remaining_seconds < 300) { // Less than 5 minutes
    this.showToast(`${Math.floor(allowance.remaining_seconds / 60)} minutes remaining`);
  }
}

// Example: Recording usage (check with logging)
async logUsageInterval(child, activityType, durationSeconds) {
  const result = await this.allow2Client.checkActivity({
    child_id: child.id,
    activity_type: activityType,
    duration_seconds: durationSeconds,
    log_usage: true,  // Consume quota
    metadata: {
      device: 'laptop-agent-123',
      application: 'Steam'
    }
  });

  if (!result.allowed) {
    // Quota exceeded - enforce block
    await this.triggerBlockAction(child, activityType);
  }

  return result;
}
```

### Allow2 Platform API

#### Check Activity Endpoint

**Request:** `POST /api/v3/check-activity`

```typescript
interface CheckActivityRequest {
  child_id: string;
  activity_type: string;  // 'gaming', 'internet', 'tv', 'social_media', etc.

  // Usage logging control
  log_usage: boolean;  // true = consume quota, false = check only
  duration_seconds?: number;  // Only if log_usage = true

  // Optional metadata
  device_id?: string;
  application?: string;
  metadata?: Record<string, any>;

  // Preview mode
  check_only?: boolean;  // Alias for log_usage: false
}

interface CheckActivityResponse {
  // Core allowance status
  allowed: boolean;  // Can child currently do this activity?

  // Quota information
  remaining_seconds: number;  // -1 = unlimited
  quota_consumed: boolean;  // true if this request consumed quota

  // Rate information
  consumption_rate: number;  // 1.0 = normal, 2.0 = double speed, 0.5 = half speed

  // Bans and blocks
  is_banned: boolean;  // General ban active
  is_activity_blocked: boolean;  // This specific activity blocked
  ban_reason?: string;
  ban_until?: string;  // ISO timestamp

  // Time windows
  current_window: {
    start: string;  // ISO timestamp
    end: string;    // ISO timestamp
    quota_seconds: number;
    used_seconds: number;
  };

  // Next change
  next_change_at?: string;  // When status might change (ISO timestamp)
  next_change_reason?: string;  // 'quota_reset' | 'ban_expires' | 'window_change'

  // Warnings
  warnings: Array<{
    type: 'low_quota' | 'approaching_ban' | 'rate_change';
    message: string;
    threshold_seconds?: number;
  }>;
}
```

**Example: Check Only (No Logging)**

```bash
curl -X POST https://api.allow2.com/api/v3/check-activity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${PARENT_API_KEY}" \
  -d '{
    "child_id": "child-bobby-123",
    "activity_type": "gaming",
    "log_usage": false,
    "check_only": true,
    "device_id": "agent-laptop-456"
  }'
```

**Response:**

```json
{
  "allowed": true,
  "remaining_seconds": 1800,
  "quota_consumed": false,
  "consumption_rate": 1.0,
  "is_banned": false,
  "is_activity_blocked": false,
  "current_window": {
    "start": "2026-01-15T00:00:00Z",
    "end": "2026-01-15T23:59:59Z",
    "quota_seconds": 3600,
    "used_seconds": 1800
  },
  "next_change_at": "2026-01-16T00:00:00Z",
  "next_change_reason": "quota_reset",
  "warnings": [
    {
      "type": "low_quota",
      "message": "Less than 30 minutes remaining",
      "threshold_seconds": 1800
    }
  ]
}
```

**Example: Log Usage (Consume Quota)**

```bash
curl -X POST https://api.allow2.com/api/v3/check-activity \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${PARENT_API_KEY}" \
  -d '{
    "child_id": "child-bobby-123",
    "activity_type": "gaming",
    "log_usage": true,
    "duration_seconds": 300,
    "device_id": "agent-laptop-456",
    "application": "Steam",
    "metadata": {
      "game": "Minecraft",
      "process_hash": "a3b2c1d4..."
    }
  }'
```

**Response:**

```json
{
  "allowed": true,
  "remaining_seconds": 1500,
  "quota_consumed": true,
  "consumption_rate": 1.0,
  "is_banned": false,
  "is_activity_blocked": false,
  "current_window": {
    "start": "2026-01-15T00:00:00Z",
    "end": "2026-01-15T23:59:59Z",
    "quota_seconds": 3600,
    "used_seconds": 2100
  },
  "next_change_at": "2026-01-16T00:00:00Z",
  "next_change_reason": "quota_reset",
  "warnings": [
    {
      "type": "low_quota",
      "message": "Less than 30 minutes remaining",
      "threshold_seconds": 1800
    }
  ]
}
```

### Plugin Implementation Pattern

#### Recommended Usage Pattern

```javascript
class BasePluginMonitor {
  constructor(allow2Client) {
    this.allow2Client = allow2Client;
    this.lastCheckCache = new Map();  // Short-lived cache (max 5 seconds)
  }

  /**
   * Check current allowance without consuming quota
   * Use for: UI updates, warnings, preview checks
   */
  async checkAllowance(childId, activityType) {
    const allowance = await this.allow2Client.checkActivity({
      child_id: childId,
      activity_type: activityType,
      log_usage: false,
      check_only: true
    });

    // Cache for max 5 seconds to avoid hammering API
    this.lastCheckCache.set(`${childId}:${activityType}`, {
      allowance,
      timestamp: Date.now()
    });

    return allowance;
  }

  /**
   * Log actual usage and consume quota
   * Use for: Recording usage intervals
   */
  async logUsage(childId, activityType, durationSeconds, metadata = {}) {
    const result = await this.allow2Client.checkActivity({
      child_id: childId,
      activity_type: activityType,
      duration_seconds: durationSeconds,
      log_usage: true,
      metadata
    });

    // Clear cache on usage log
    this.lastCheckCache.delete(`${childId}:${activityType}`);

    return result;
  }

  /**
   * Get cached allowance if available and fresh (< 5 seconds old)
   * Otherwise fetch fresh data
   */
  async getAllowanceWithCache(childId, activityType) {
    const cacheKey = `${childId}:${activityType}`;
    const cached = this.lastCheckCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < 5000) {
      return cached.allowance;
    }

    return await this.checkAllowance(childId, activityType);
  }

  /**
   * Make enforcement decision based on current allowance
   */
  async shouldBlock(childId, activityType) {
    const allowance = await this.checkAllowance(childId, activityType);

    return (
      !allowance.allowed ||
      allowance.is_banned ||
      allowance.is_activity_blocked ||
      allowance.remaining_seconds <= 0
    );
  }
}
```

#### Example: Gaming Monitor Plugin

```javascript
class GamingMonitorPlugin extends BasePluginMonitor {
  async monitorGameSession(child, gameProcess) {
    const activityType = 'gaming';
    let sessionStart = Date.now();
    let lastLogTime = sessionStart;
    let warningShown = false;

    const monitorInterval = setInterval(async () => {
      const now = Date.now();
      const sessionDuration = Math.floor((now - lastLogTime) / 1000);

      // Every 5 minutes, log usage
      if (sessionDuration >= 300) {
        const result = await this.logUsage(
          child.id,
          activityType,
          sessionDuration,
          {
            game: gameProcess.name,
            process_hash: gameProcess.hash
          }
        );

        lastLogTime = now;

        // Check if we should block
        if (!result.allowed || result.remaining_seconds <= 0) {
          clearInterval(monitorInterval);
          await this.blockGame(child, gameProcess);
          return;
        }

        // Show warning if less than 5 minutes remaining
        if (result.remaining_seconds < 300 && !warningShown) {
          await this.showWarning(child, result.remaining_seconds);
          warningShown = true;
        }
      }

      // Every 30 seconds, check (without logging) for external changes
      const allowance = await this.checkAllowance(child.id, activityType);

      // Immediate block conditions
      if (
        allowance.is_banned ||
        allowance.is_activity_blocked ||
        (!allowance.allowed && sessionDuration > 60) // Grace period for startup
      ) {
        // Log final usage before blocking
        const finalDuration = Math.floor((now - lastLogTime) / 1000);
        if (finalDuration > 0) {
          await this.logUsage(child.id, activityType, finalDuration);
        }

        clearInterval(monitorInterval);
        await this.blockGame(child, gameProcess);
      }
    }, 30000); // Check every 30 seconds

    // Clean up on process exit
    gameProcess.on('exit', async () => {
      clearInterval(monitorInterval);
      const finalDuration = Math.floor((Date.now() - lastLogTime) / 1000);
      if (finalDuration > 0) {
        await this.logUsage(child.id, activityType, finalDuration);
      }
    });
  }
}
```

### Best Practices

1. **Never Cache Allowances Long-Term**
   - Maximum cache: 5 seconds
   - Always fetch fresh before enforcement decisions
   - Clear cache after logging usage

2. **Use `log_usage: false` for:**
   - UI updates
   - Warning notifications
   - Preview checks
   - Frequent status polls

3. **Use `log_usage: true` for:**
   - Actual usage intervals (every 5 minutes recommended)
   - Final session logging
   - Quota consumption events

4. **Handle Dynamic Changes Gracefully**
   - Check for bans every 30-60 seconds
   - Respect `next_change_at` for optimized polling
   - Show user-friendly messages for external changes

5. **Batch Usage Logging**
   - Don't log every second
   - Recommended: 5-minute intervals
   - Log final usage on activity end

6. **Monitor for External Changes**
   - Poll periodically (30-60 seconds)
   - Check `warnings` array for upcoming limits
   - React immediately to `is_banned` or `is_activity_blocked`

---

## Offline Mode with Plugin Extensions

### Problem: Time-Based Controls During Network Outages

**Scenario:**
- Parent sets quota: 1 hour gaming/day for child
- Child plays 45 minutes
- Network goes offline
- Child continues playing

**Question:** Should agent enforce remaining 15 minutes?

### Solution Option 1: Periodic Shutdown Time Updates (RECOMMENDED)

**Design:**

Instead of parent waiting until time is exhausted to send kill command, parent **continuously updates agent with expected shutdown time and commands**.

```
┌─────────────────────────────────────────────────────────────┐
│ Parent-Side Plugin Logic                                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Every heartbeat/sync:                                        │
│ 1. Receive current game state from agent monitor             │
│ 2. Calculate remaining time based on quota                   │
│ 3. Compute shutdown timestamp = now + remainingTime          │
│ 4. Send shutdown command with timestamp to agent             │
│                                                              │
│ Example:                                                     │
│ - Time played today: 45 minutes                              │
│ - Quota: 60 minutes                                          │
│ - Remaining: 15 minutes                                      │
│ - Current time: 2:00 PM                                      │
│ - Shutdown time: 2:15 PM                                     │
│                                                              │
│ triggerAction('terminate-game', {                            │
│   shutdownTime: Date.now() + (15 * 60 * 1000),              │
│   warningIntervals: [10, 5, 2, 1]  // Minutes before        │
│ });                                                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Agent-Side Behavior                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ - Receives shutdown time: 2:15 PM                            │
│ - Stores locally                                             │
│ - Starts countdown timer                                     │
│                                                              │
│ - At 2:05 PM → Toast: "10 minutes remaining"                │
│ - At 2:10 PM → Toast: "5 minutes remaining"                 │
│ - At 2:13 PM → Toast: "2 minutes remaining"                 │
│ - At 2:14 PM → Toast: "1 minute remaining"                  │
│ - At 2:15 PM → Terminate process                             │
│                                                              │
│ ✅ Works offline - countdown continues even if network down  │
│ ✅ Provides warnings - child is aware of impending shutdown  │
│ ✅ Enforces quota - shutdown happens regardless of network   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Periodic Updates                                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Next heartbeat (30 seconds later):                           │
│ - Child still playing                                        │
│ - Time remaining: 14.5 minutes                               │
│ - Parent updates shutdown time: 2:14:30 PM                   │
│ - Agent adjusts countdown                                    │
│                                                              │
│ ✅ Keeps shutdown time current                               │
│ ✅ Accounts for pauses (if child stops playing)              │
│ ✅ Works if network is intermittent                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Full Offline Scenario                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 1. Last sync: 2:00 PM, shutdown time set to 2:15 PM         │
│ 2. Network goes offline at 2:05 PM                           │
│ 3. Agent continues countdown locally                         │
│ 4. Agent shows warnings: 10min, 5min, 2min, 1min             │
│ 5. Agent terminates process at 2:15 PM                       │
│ 6. Network comes back online at 3:00 PM                      │
│ 7. Agent reports action completion:                          │
│    - "Process terminated at 2:15 PM"                         │
│    - "Network was offline - used cached shutdown time"       │
│                                                              │
│ ✅ Quota enforced despite network outage                     │
│ ✅ Child received warnings                                   │
│ ✅ Parent receives confirmation after reconnection           │
└─────────────────────────────────────────────────────────────┘
```

### Solution Option 2: Partial Agent-Side Logic

**Design:**

Place quota calculation logic on agent side. Agent tracks playtime and enforces quotas locally.

**Pros:**
- Works perfectly offline
- No dependency on parent for quota enforcement
- Child dropping game pauses timer automatically

**Cons:**
- ⚠️ **Harder for plugin developers** - Must write agent-side logic
- ⚠️ **Duplication** - Quota logic exists on both parent and agent
- ⚠️ **Complexity** - Agent must understand plugin-specific business rules
- ⚠️ **Updates** - Changes to quota logic require agent plugin update

**Verdict:** Not recommended. Violates separation of concerns (agent should be dumb transport).

### Solution Option 3: Conservative Shutdown (Fail-Safe)

**Design:**

If network is offline and agent hasn't received updated shutdown time:
- Use last known shutdown time
- Add conservative buffer (e.g., terminate 5 minutes early)

**Pros:**
- Ensures child doesn't exceed quota
- Doesn't require complex agent-side logic

**Cons:**
- ⚠️ **Unfair** - Child loses time they're entitled to
- ⚠️ **User experience** - Unexpected early shutdowns
- ⚠️ **Not accurate** - Doesn't account for pauses

**Verdict:** Use as fallback if Option 1 fails, but not primary solution.

### Recommended Implementation: Option 1 with Enhancements

**Enhanced Periodic Updates:**

```javascript
// Parent-side plugin monitor
class GameMonitorPlugin {
  onDataReceived(agentId, monitorData) {
    const { gameActive, currentUser, playtime } = monitorData;

    if (gameActive) {
      // Calculate remaining time
      const quota = this.getQuota(currentUser); // 60 minutes
      const played = this.getPlayedToday(currentUser); // 45 minutes
      const remaining = quota - played; // 15 minutes

      if (remaining > 0) {
        // Update shutdown time continuously
        const shutdownTime = Date.now() + (remaining * 60 * 1000);

        this.pluginManager.triggerAction(agentId, {
          pluginId: 'game-monitor-v1',
          actionId: 'schedule-shutdown',
          arguments: {
            shutdownTime,
            processName: 'Steam.exe',
            warningIntervals: [10, 5, 2, 1], // Minutes
            reason: 'Daily time limit'
          }
        });
      } else {
        // Time's up - immediate shutdown
        this.pluginManager.triggerAction(agentId, {
          pluginId: 'game-monitor-v1',
          actionId: 'terminate-game-immediate',
          arguments: {
            processName: 'Steam.exe',
            reason: 'Daily time limit exceeded'
          }
        });
      }
    } else {
      // Game not active - cancel any pending shutdowns
      this.pluginManager.triggerAction(agentId, {
        pluginId: 'game-monitor-v1',
        actionId: 'cancel-shutdown',
        arguments: {}
      });
    }
  }
}
```

**Agent-side action handler:**

```javascript
// Agent: Plugin action handler
class ShutdownScheduler {
  constructor() {
    this.currentShutdown = null;
    this.warningTimer = null;
  }

  scheduleShutdown(args) {
    const { shutdownTime, processName, warningIntervals, reason } = args;

    // Cancel previous shutdown if exists
    this.cancelShutdown();

    // Store shutdown info
    this.currentShutdown = {
      shutdownTime,
      processName,
      reason
    };

    // Schedule warnings
    warningIntervals.forEach(minutes => {
      const warningTime = shutdownTime - (minutes * 60 * 1000);
      const delay = warningTime - Date.now();

      if (delay > 0) {
        setTimeout(() => {
          this.showWarning(`${minutes} minute${minutes > 1 ? 's' : ''} remaining`);
        }, delay);
      }
    });

    // Schedule shutdown
    const shutdownDelay = shutdownTime - Date.now();
    if (shutdownDelay > 0) {
      this.shutdownTimer = setTimeout(() => {
        this.executeShutdown();
      }, shutdownDelay);
    }

    return { success: true, scheduledFor: shutdownTime };
  }

  cancelShutdown() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
    this.currentShutdown = null;
  }

  executeShutdown() {
    const { processName, reason } = this.currentShutdown;

    this.logger.info('Executing scheduled shutdown', {
      processName,
      reason,
      networkStatus: this.isOnline() ? 'online' : 'offline'
    });

    // Terminate process
    this.terminateProcess(processName);

    // Queue confirmation for parent
    this.queueActionResponse({
      action: 'shutdown-executed',
      processName,
      executedAt: Date.now(),
      networkWasOffline: !this.isOnline()
    });
  }
}
```

**Benefits:**
- ✅ Works offline (agent has shutdown time)
- ✅ Child gets warnings (toast notifications)
- ✅ Quota enforced accurately
- ✅ Simple plugin developer experience (parent-side logic only)
- ✅ Accounts for pauses (parent stops sending updates if game inactive)

---

## Analytics & Telemetry

### Purpose

Track usage patterns and reliability of plugin communications to:
1. Identify failing plugins on specific platforms
2. Measure communication overhead and frequency
3. Detect anomalies (unusual traffic, errors)
4. Optimize batching and debounce settings

### Anonymization

**Personally Identifiable Information (PII) is NOT collected:**
- ❌ No usernames
- ❌ No machine names
- ❌ No IP addresses (except aggregated geographic region)
- ❌ No specific game titles or app names

**Data Collected (Anonymized):**
- ✅ Plugin ID (generic identifier)
- ✅ Platform (win32, darwin, linux)
- ✅ Success/failure rates
- ✅ Average response times
- ✅ Data volume (KB transferred)
- ✅ Geographic region (continent/country only)
- ✅ Error types (not error messages with PII)

### Analytics Data Structure

**Database Schema:**

```sql
CREATE TABLE plugin_analytics (
  id VARCHAR(36) PRIMARY KEY,
  plugin_id VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
    -- 'monitor_execute', 'monitor_success', 'monitor_failure',
    -- 'action_trigger', 'action_success', 'action_failure',
    -- 'data_sync', 'response_batch'
  platform VARCHAR(20),
  region VARCHAR(50),  -- 'North America', 'Europe', etc.
  timestamp DATETIME NOT NULL,

  -- Performance metrics
  execution_time_ms INTEGER,
  data_size_bytes INTEGER,
  batch_size INTEGER,

  -- Reliability metrics
  success BOOLEAN,
  error_type VARCHAR(100),  -- Generic error category, not message

  -- Aggregation
  count INTEGER DEFAULT 1,

  INDEX idx_plugin_timestamp (plugin_id, timestamp),
  INDEX idx_platform_event (platform, event_type)
);
```

**Collection Points:**

```javascript
// Agent: src/PluginExtensionManager.js
class PluginExtensionManager {
  async executeMonitor(pluginId, monitorId) {
    const startTime = Date.now();

    try {
      const result = await this.sandbox.execute(monitor.script);

      // Record success
      this.analytics.record({
        pluginId,
        eventType: 'monitor_success',
        platform: process.platform,
        executionTimeMs: Date.now() - startTime,
        dataSizeBytes: JSON.stringify(result).length
      });

    } catch (error) {
      // Record failure (anonymized error type)
      this.analytics.record({
        pluginId,
        eventType: 'monitor_failure',
        platform: process.platform,
        executionTimeMs: Date.now() - startTime,
        errorType: this.categorizeError(error)  // Generic category
      });
    }
  }

  categorizeError(error) {
    // Map specific errors to generic categories
    if (error.message.includes('timeout')) return 'timeout';
    if (error.message.includes('permission')) return 'permission_denied';
    if (error.message.includes('not found')) return 'resource_not_found';
    return 'unknown';
  }
}
```

**Analytics Dashboard (Parent UI):**

```
┌────────────────────────────────────────────────────────────┐
│ Plugin Analytics Dashboard                                 │
├────────────────────────────────────────────────────────────┤
│                                                             │
│ Plugin: game-monitor-v1                                    │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Success Rate (Last 30 Days)                          │   │
│ │                                                       │   │
│ │ Windows:   ████████████████████░░ 95%                │   │
│ │ macOS:     ████████████████░░░░░░ 89%                │   │
│ │ Linux:     ███████████████████░░░ 92%                │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Average Response Time                                 │   │
│ │                                                       │   │
│ │ Monitor execution: 234ms                              │   │
│ │ Action execution:  1.2s                               │   │
│ │ Data sync:         187ms                              │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Usage Volume (Last 7 Days)                            │   │
│ │                                                       │   │
│ │ Monitor executions: 12,450                            │   │
│ │ Action triggers:    3,234                             │   │
│ │ Data transferred:   2.4 MB                            │   │
│ │ Average batch size: 4.2 items                         │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Common Errors                                         │   │
│ │                                                       │   │
│ │ timeout:            42 occurrences (macOS)            │   │
│ │ permission_denied:  18 occurrences (Linux)            │   │
│ │ resource_not_found:  9 occurrences (Windows)          │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                             │
│ ┌─────────────────────────────────────────────────────┐   │
│ │ Geographic Distribution                               │   │
│ │                                                       │   │
│ │ North America: 45%                                    │   │
│ │ Europe:        32%                                    │   │
│ │ Asia-Pacific:  18%                                    │   │
│ │ Other:          5%                                    │   │
│ └─────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

### Privacy Compliance

**Data Retention:**
- Raw analytics: 90 days
- Aggregated data: Indefinite (no PII)

**Opt-Out:**
- Users can disable analytics in settings
- Anonymized data continues to be collected (platform/plugin success rates)
- No user-specific data if opted out

**GDPR/Privacy Compliance:**
- No PII collected
- Anonymous IDs only (not tied to user accounts)
- Geographic region (continent/country) only
- Data can be deleted on request

---

## Implementation Checklist

### Phase 1: Plugin Infrastructure

**Parent-Side:**
- [ ] Create `PluginManager` service
- [ ] Define plugin manifest schema
- [ ] Create plugin deployment API
- [ ] Implement plugin registry (active plugins)

**Agent-Side:**
- [ ] Create `PluginExtensionManager`
- [ ] Implement script sandbox (VM2 or isolated-vm)
- [ ] Create monitor execution scheduler
- [ ] Implement action execution queue

### Phase 2: Data Monitor System

**Agent-Side:**
- [ ] Data queue persistence (offline-resilient)
- [ ] Monitor script caching
- [ ] Periodic execution scheduler
- [ ] Data batching for sync

**Parent-Side:**
- [ ] Plugin data collection API
- [ ] Plugin monitor callback system
- [ ] Data processing pipeline

### Phase 3: Action System

**Parent-Side:**
- [ ] Action trigger API
- [ ] Action queue database
- [ ] Action status tracking
- [ ] Debounce implementation

**Agent-Side:**
- [ ] Action script caching
- [ ] Action execution sandbox
- [ ] Response batching (2-second debounce)
- [ ] Action result queue

### Phase 4: Offline Resilience

- [ ] Shutdown scheduling system (Option 1)
- [ ] Warning notification system (toast/native)
- [ ] Offline action execution
- [ ] Post-reconnection reporting

### Phase 5: Analytics

- [ ] Analytics collection infrastructure
- [ ] Error categorization
- [ ] Dashboard UI
- [ ] Privacy controls (opt-out)

---

## Process Auditing System

### Overview

The Process Auditing System provides continuous monitoring of running processes on agent machines with intelligent classification and delta-based reporting to minimize network overhead. This system is **agent-supplied data** (not per-plugin), making process information available to all plugins through a shared process registry.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Parent Application                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │            Allow2 Classification Service                   │  │
│  │  - Receives unknown process signatures                     │  │
│  │  - Returns classification (game, browser, social, etc.)    │  │
│  │  - Accepts plugin classification suggestions               │  │
│  │  - Parent overrides available                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                             │                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         Process Classification Database                    │  │
│  │  - Known process fingerprints → classifications            │  │
│  │  - Parent overrides                                        │  │
│  │  - Plugin suggestions (rolled up to Allow2)               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                             │                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Plugin Manager                            │  │
│  │  - Plugins receive process events                          │  │
│  │  - Plugins query process registry                          │  │
│  │  - Plugins suggest classifications                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│           │                  │                  │                │
│     Plugin A           Plugin B           Plugin C               │
│  (Game Monitor)    (Browser Monitor)  (Screen Time)              │
│                                                                   │
└───────────────────────────────┬───────────────────────────────────┘
                                │ Secure Agent API
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Agent (Remote Machine)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           Process Auditor (Core Agent Service)             │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Platform-Specific Process Monitor                   │  │  │
│  │  │  - Windows: WMI / tasklist                           │  │  │
│  │  │  - macOS: ps / libproc                               │  │  │
│  │  │  - Linux: /proc filesystem                           │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Process Fingerprinting Engine                       │  │  │
│  │  │  - Process name                                      │  │  │
│  │  │  - Executable path                                   │  │  │
│  │  │  - File hash (SHA-256)                               │  │  │
│  │  │  - Digital signature verification                    │  │  │
│  │  │  - Command line arguments (sanitized)                │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Local Process Registry (SQLite)                     │  │  │
│  │  │  - Current running processes                         │  │  │
│  │  │  - Process fingerprints                              │  │  │
│  │  │  - Classification cache                              │  │  │
│  │  │  - Process start/stop timestamps                     │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Delta Calculator                                    │  │  │
│  │  │  - Compare previous scan → current scan              │  │  │
│  │  │  - Identify: NEW processes, TERMINATED processes     │  │  │
│  │  │  - Filter out system/noise processes                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Classification Manager                              │  │  │
│  │  │  - Check local cache first                           │  │  │
│  │  │  - Queue unknown processes for API classification    │  │  │
│  │  │  - Apply classifications from parent                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                           │                                │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Event Queue (Delta Only)                            │  │  │
│  │  │  - process_started events                            │  │  │
│  │  │  - process_stopped events                            │  │  │
│  │  │  - classification_needed requests                    │  │  │
│  │  │  - Batched for next heartbeat                        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                             │                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         Plugin Query Interface                             │  │
│  │  - Plugins can query: "Is Steam running?"                 │  │
│  │  - Plugins can query: "What games are running?"           │  │
│  │  - Plugins receive: process_started/stopped events        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└───────────────────────────────┬───────────────────────────────────┘
                                │ Heartbeat (Delta Events Only)
                                ▼
```

### Core Components

#### 1. Platform-Specific Process Monitoring

**Cross-Platform Process Monitor Interface:**

```typescript
// src/core/process-auditor/ProcessMonitor.ts

interface ProcessInfo {
  pid: number;
  name: string;
  path: string;
  commandLine: string;
  parentPid: number;
  userId: number;
  userName: string;
  startTime: Date;
  cpuPercent?: number;
  memoryMB?: number;
}

abstract class ProcessMonitor {
  abstract getRunningProcesses(): Promise<ProcessInfo[]>;
  abstract getProcessDetails(pid: number): Promise<ProcessInfo | null>;
}
```

**Windows Implementation:**

```typescript
// src/core/process-auditor/WindowsProcessMonitor.ts

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

class WindowsProcessMonitor extends ProcessMonitor {
  async getRunningProcesses(): Promise<ProcessInfo[]> {
    // Method 1: PowerShell WMI (detailed info)
    const psScript = `
      Get-WmiObject Win32_Process | Select-Object
        ProcessId,
        Name,
        ExecutablePath,
        CommandLine,
        ParentProcessId,
        @{Name="Owner";Expression={$_.GetOwner().User}},
        CreationDate,
        WorkingSetSize
      | ConvertTo-Json
    `;

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`,
        { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
      );

      const processes = JSON.parse(stdout);
      return processes.map((p: any) => ({
        pid: p.ProcessId,
        name: p.Name,
        path: p.ExecutablePath || '',
        commandLine: p.CommandLine || '',
        parentPid: p.ParentProcessId,
        userId: 0, // Windows SID would require additional lookup
        userName: p.Owner || '',
        startTime: new Date(p.CreationDate),
        memoryMB: Math.round(p.WorkingSetSize / (1024 * 1024))
      }));
    } catch (error) {
      // Fallback to tasklist (faster but less info)
      return this.getProcessesFromTasklist();
    }
  }

  private async getProcessesFromTasklist(): Promise<ProcessInfo[]> {
    const { stdout } = await execAsync('tasklist /FO CSV /V', {
      encoding: 'utf-8'
    });

    // Parse CSV output
    const lines = stdout.split('\n').slice(1); // Skip header
    return lines
      .filter(line => line.trim())
      .map(line => {
        const cols = this.parseCSVLine(line);
        return {
          pid: parseInt(cols[1]),
          name: cols[0],
          path: '', // Not available in tasklist
          commandLine: '',
          parentPid: 0,
          userId: 0,
          userName: cols[6] || '', // User Name column
          startTime: new Date(),
          memoryMB: parseInt(cols[4].replace(/[^\d]/g, '')) / 1024
        };
      });
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }

  async getProcessDetails(pid: number): Promise<ProcessInfo | null> {
    const psScript = `
      Get-WmiObject Win32_Process -Filter "ProcessId = ${pid}"
      | Select-Object ProcessId, Name, ExecutablePath, CommandLine, ParentProcessId
      | ConvertTo-Json
    `;

    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`
      );
      const process = JSON.parse(stdout);

      if (!process) return null;

      return {
        pid: process.ProcessId,
        name: process.Name,
        path: process.ExecutablePath || '',
        commandLine: process.CommandLine || '',
        parentPid: process.ParentProcessId,
        userId: 0,
        userName: '',
        startTime: new Date()
      };
    } catch {
      return null;
    }
  }
}
```

**macOS Implementation:**

```typescript
// src/core/process-auditor/MacOSProcessMonitor.ts

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

class MacOSProcessMonitor extends ProcessMonitor {
  async getRunningProcesses(): Promise<ProcessInfo[]> {
    // Use ps with custom format
    const psCommand = 'ps -Ao pid,ppid,user,comm,%cpu,%mem,lstart -c';

    try {
      const { stdout } = await execAsync(psCommand);
      const lines = stdout.split('\n').slice(1); // Skip header

      const processes = await Promise.all(
        lines
          .filter(line => line.trim())
          .map(async line => {
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[0]);
            const ppid = parseInt(parts[1]);
            const user = parts[2];
            const name = parts[3];
            const cpu = parseFloat(parts[4]);
            const mem = parseFloat(parts[5]);
            const startTime = new Date(parts.slice(6).join(' '));

            // Get full path using lsof
            const path = await this.getProcessPath(pid);

            return {
              pid,
              parentPid: ppid,
              userName: user,
              name,
              path: path || '',
              commandLine: '', // Will be fetched separately if needed
              userId: 0, // Would require additional lookup
              startTime,
              cpuPercent: cpu,
              memoryMB: mem * (await this.getTotalMemoryGB()) * 1024 / 100
            };
          })
      );

      return processes;
    } catch (error) {
      console.error('Failed to get processes:', error);
      return [];
    }
  }

  private async getProcessPath(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `lsof -p ${pid} -Fn | grep '^n/' | head -1`
      );
      return stdout.trim().substring(1); // Remove 'n' prefix
    } catch {
      return null;
    }
  }

  private async getTotalMemoryGB(): Promise<number> {
    const { stdout } = await execAsync('sysctl hw.memsize');
    const bytes = parseInt(stdout.split(':')[1].trim());
    return bytes / (1024 * 1024 * 1024);
  }

  async getProcessDetails(pid: number): Promise<ProcessInfo | null> {
    try {
      const { stdout } = await execAsync(
        `ps -p ${pid} -o pid,ppid,user,comm,%cpu,%mem,lstart`
      );
      const lines = stdout.split('\n');
      if (lines.length < 2) return null;

      const parts = lines[1].trim().split(/\s+/);
      const path = await this.getProcessPath(pid);

      return {
        pid: parseInt(parts[0]),
        parentPid: parseInt(parts[1]),
        userName: parts[2],
        name: parts[3],
        path: path || '',
        commandLine: '',
        userId: 0,
        startTime: new Date(parts.slice(6).join(' ')),
        cpuPercent: parseFloat(parts[4])
      };
    } catch {
      return null;
    }
  }
}
```

**Linux Implementation:**

```typescript
// src/core/process-auditor/LinuxProcessMonitor.ts

import * as fs from 'fs/promises';
import * as path from 'path';

class LinuxProcessMonitor extends ProcessMonitor {
  async getRunningProcesses(): Promise<ProcessInfo[]> {
    const procDir = '/proc';

    try {
      const entries = await fs.readdir(procDir);

      // Filter for PID directories (numeric)
      const pidDirs = entries.filter(entry => /^\d+$/.test(entry));

      const processes = await Promise.all(
        pidDirs.map(async pid => {
          try {
            return await this.getProcessDetails(parseInt(pid));
          } catch {
            return null; // Process may have terminated
          }
        })
      );

      return processes.filter((p): p is ProcessInfo => p !== null);
    } catch (error) {
      console.error('Failed to read /proc:', error);
      return [];
    }
  }

  async getProcessDetails(pid: number): Promise<ProcessInfo | null> {
    const procPath = `/proc/${pid}`;

    try {
      // Read /proc/[pid]/stat
      const stat = await fs.readFile(`${procPath}/stat`, 'utf-8');
      const statParts = this.parseStatFile(stat);

      // Read /proc/[pid]/status
      const status = await fs.readFile(`${procPath}/status`, 'utf-8');
      const statusMap = this.parseStatusFile(status);

      // Read /proc/[pid]/cmdline
      const cmdline = await fs.readFile(`${procPath}/cmdline`, 'utf-8');
      const commandLine = cmdline.replace(/\0/g, ' ').trim();

      // Read /proc/[pid]/exe (symlink to executable)
      let exePath = '';
      try {
        exePath = await fs.readlink(`${procPath}/exe`);
      } catch {
        // Permission denied or process terminated
      }

      // Calculate start time
      const uptimeSeconds = await this.getSystemUptime();
      const clockTicks = parseInt(statParts[21]);
      const ticksPerSecond = 100; // Usually 100 on Linux
      const processUptimeSeconds = clockTicks / ticksPerSecond;
      const startTime = new Date(
        Date.now() - (uptimeSeconds - processUptimeSeconds) * 1000
      );

      return {
        pid,
        name: statusMap.Name || statParts[1].replace(/[()]/g, ''),
        path: exePath,
        commandLine,
        parentPid: parseInt(statParts[3]),
        userId: parseInt(statusMap.Uid?.split('\t')[0] || '0'),
        userName: '', // Would require /etc/passwd lookup
        startTime,
        memoryMB: parseInt(statusMap.VmRSS?.split('\t')[0] || '0') / 1024
      };
    } catch (error) {
      return null;
    }
  }

  private parseStatFile(stat: string): string[] {
    // Handle process names with spaces and parentheses
    const commStart = stat.indexOf('(');
    const commEnd = stat.lastIndexOf(')');
    const comm = stat.substring(commStart + 1, commEnd);
    const rest = stat.substring(commEnd + 2).split(' ');
    return ['', comm, ...rest];
  }

  private parseStatusFile(status: string): Record<string, string> {
    const map: Record<string, string> = {};
    status.split('\n').forEach(line => {
      const [key, value] = line.split(':', 2);
      if (key && value) {
        map[key.trim()] = value.trim();
      }
    });
    return map;
  }

  private async getSystemUptime(): Promise<number> {
    const uptime = await fs.readFile('/proc/uptime', 'utf-8');
    return parseFloat(uptime.split(' ')[0]);
  }
}
```

#### 2. Process Fingerprinting Engine

**Fingerprint Generation:**

```typescript
// src/core/process-auditor/ProcessFingerprinter.ts

import * as crypto from 'crypto';
import * as fs from 'fs/promises';

interface ProcessFingerprint {
  processId: string; // Unique identifier for this process instance
  name: string;
  path: string;
  fileHash: string | null; // SHA-256 of executable
  signature: string | null; // Digital signature info (Windows/macOS)
  publisher: string | null;
  version: string | null;
  commandLinePattern: string; // Sanitized pattern (no PII)
}

class ProcessFingerprinter {
  private hashCache = new Map<string, string>();

  async fingerprint(process: ProcessInfo): Promise<ProcessFingerprint> {
    const processId = this.generateProcessId(process);
    const fileHash = await this.calculateFileHash(process.path);
    const signature = await this.verifySignature(process.path);
    const version = await this.getFileVersion(process.path);
    const commandLinePattern = this.sanitizeCommandLine(process.commandLine);

    return {
      processId,
      name: process.name,
      path: process.path,
      fileHash,
      signature: signature?.verified ? signature.publisher : null,
      publisher: signature?.publisher || null,
      version,
      commandLinePattern
    };
  }

  private generateProcessId(process: ProcessInfo): string {
    // Unique ID for this process instance (not the fingerprint)
    return `${process.pid}_${process.startTime.getTime()}`;
  }

  private async calculateFileHash(filePath: string): Promise<string | null> {
    if (!filePath) return null;

    // Check cache first
    if (this.hashCache.has(filePath)) {
      return this.hashCache.get(filePath)!;
    }

    try {
      const fileBuffer = await fs.readFile(filePath);
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const hashString = hash.digest('hex');

      this.hashCache.set(filePath, hashString);
      return hashString;
    } catch (error) {
      // Permission denied or file not found
      return null;
    }
  }

  private async verifySignature(
    filePath: string
  ): Promise<{ verified: boolean; publisher: string | null } | null> {
    if (!filePath) return null;

    if (process.platform === 'win32') {
      return this.verifyWindowsSignature(filePath);
    } else if (process.platform === 'darwin') {
      return this.verifyMacOSSignature(filePath);
    }

    return null;
  }

  private async verifyWindowsSignature(
    filePath: string
  ): Promise<{ verified: boolean; publisher: string | null } | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const psScript = `
        $sig = Get-AuthenticodeSignature "${filePath}"
        @{
          Status = $sig.Status.ToString()
          Subject = $sig.SignerCertificate.Subject
        } | ConvertTo-Json
      `;

      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`,
        { timeout: 5000 }
      );

      const result = JSON.parse(stdout);
      const verified = result.Status === 'Valid';
      const publisher = verified ? this.parseSubject(result.Subject) : null;

      return { verified, publisher };
    } catch {
      return null;
    }
  }

  private async verifyMacOSSignature(
    filePath: string
  ): Promise<{ verified: boolean; publisher: string | null } | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(`codesign -dv "${filePath}" 2>&1`, {
        timeout: 5000
      });

      const verified = stdout.includes('valid on disk');
      const authorityMatch = stdout.match(/Authority=(.+)/);
      const publisher = authorityMatch ? authorityMatch[1].trim() : null;

      return { verified, publisher };
    } catch {
      return null;
    }
  }

  private parseSubject(subject: string): string | null {
    // Extract CN (Common Name) from subject
    const cnMatch = subject.match(/CN=([^,]+)/);
    return cnMatch ? cnMatch[1].trim() : null;
  }

  private async getFileVersion(filePath: string): Promise<string | null> {
    if (!filePath) return null;

    if (process.platform === 'win32') {
      return this.getWindowsFileVersion(filePath);
    } else if (process.platform === 'darwin') {
      return this.getMacOSFileVersion(filePath);
    }

    return null;
  }

  private async getWindowsFileVersion(filePath: string): Promise<string | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const psScript = `
        (Get-Item "${filePath}").VersionInfo.FileVersion
      `;

      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "${psScript}"`,
        { timeout: 3000 }
      );

      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async getMacOSFileVersion(filePath: string): Promise<string | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        `mdls -name kMDItemVersion "${filePath}"`,
        { timeout: 3000 }
      );

      const match = stdout.match(/kMDItemVersion = "(.+)"/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private sanitizeCommandLine(commandLine: string): string {
    // Remove PII from command line arguments
    // Keep only patterns that help identify the process type

    // Remove file paths that might contain usernames
    let sanitized = commandLine.replace(/[A-Z]:\\Users\\[^\\]+\\/gi, 'C:\\Users\\<USER>\\');
    sanitized = sanitized.replace(/\/Users\/[^\/]+\//g, '/Users/<USER>/');
    sanitized = sanitized.replace(/\/home\/[^\/]+\//g, '/home/<USER>/');

    // Remove URL parameters
    sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, '<URL>');

    // Remove email addresses
    sanitized = sanitized.replace(/[\w\.-]+@[\w\.-]+\.\w+/g, '<EMAIL>');

    // Truncate to reasonable length
    return sanitized.substring(0, 500);
  }

  /**
   * Generate a stable fingerprint hash for classification lookup
   * This is used to identify the same process across runs
   */
  generateFingerprintHash(fingerprint: ProcessFingerprint): string {
    const parts = [
      fingerprint.name.toLowerCase(),
      fingerprint.path.toLowerCase(),
      fingerprint.fileHash || '',
      fingerprint.publisher || ''
    ];

    return crypto
      .createHash('sha256')
      .update(parts.join('|'))
      .digest('hex');
  }
}
```

#### 3. Delta Calculator

**Delta Detection Algorithm:**

```typescript
// src/core/process-auditor/DeltaCalculator.ts

interface ProcessSnapshot {
  timestamp: Date;
  processes: Map<string, ProcessFingerprint>; // processId -> fingerprint
}

interface ProcessDelta {
  started: ProcessFingerprint[];
  stopped: ProcessFingerprint[];
}

class DeltaCalculator {
  private previousSnapshot: ProcessSnapshot | null = null;
  private systemProcessCache = new Set<string>();

  /**
   * Calculate delta between previous and current process snapshots
   */
  calculateDelta(
    currentProcesses: ProcessFingerprint[]
  ): ProcessDelta {
    const currentSnapshot: ProcessSnapshot = {
      timestamp: new Date(),
      processes: new Map(
        currentProcesses.map(p => [p.processId, p])
      )
    };

    if (!this.previousSnapshot) {
      // First scan - report nothing (or report all as started)
      this.previousSnapshot = currentSnapshot;
      return { started: [], stopped: [] };
    }

    const started: ProcessFingerprint[] = [];
    const stopped: ProcessFingerprint[] = [];

    // Find started processes
    for (const [processId, fingerprint] of currentSnapshot.processes) {
      if (!this.previousSnapshot.processes.has(processId)) {
        // New process - but filter out system/noise processes
        if (!this.isSystemProcess(fingerprint)) {
          started.push(fingerprint);
        }
      }
    }

    // Find stopped processes
    for (const [processId, fingerprint] of this.previousSnapshot.processes) {
      if (!currentSnapshot.processes.has(processId)) {
        // Process terminated
        if (!this.isSystemProcess(fingerprint)) {
          stopped.push(fingerprint);
        }
      }
    }

    this.previousSnapshot = currentSnapshot;

    return { started, stopped };
  }

  /**
   * Filter out system/noise processes to reduce chatter
   */
  private isSystemProcess(fingerprint: ProcessFingerprint): boolean {
    const name = fingerprint.name.toLowerCase();

    // Cache system process names for performance
    if (this.systemProcessCache.has(name)) {
      return true;
    }

    // Windows system processes
    const windowsSystem = [
      'system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe',
      'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe',
      'conhost.exe', 'fontdrvhost.exe', 'wudfhost.exe'
    ];

    // macOS system processes
    const macosSystem = [
      'kernel_task', 'launchd', 'UserEventAgent', 'cfprefsd',
      'distnoted', 'notifyd', 'syslogd', 'configd', 'mDNSResponder'
    ];

    // Linux system processes
    const linuxSystem = [
      'systemd', 'kthreadd', 'rcu_gp', 'rcu_par_gp', 'kworker',
      'kswapd', 'ksoftirqd', 'migration', 'watchdog'
    ];

    const systemProcesses = [
      ...windowsSystem,
      ...macosSystem,
      ...linuxSystem
    ];

    const isSystem = systemProcesses.some(
      sysProc => name === sysProc || name.startsWith(sysProc)
    );

    if (isSystem) {
      this.systemProcessCache.add(name);
    }

    return isSystem;
  }

  /**
   * Reset the delta calculator (useful for testing or after long idle)
   */
  reset(): void {
    this.previousSnapshot = null;
  }
}
```

#### 4. Local Process Registry (SQLite)

**Database Schema:**

```sql
-- src/core/process-auditor/schema.sql

-- Process fingerprints and classifications
CREATE TABLE IF NOT EXISTS process_registry (
  fingerprint_hash TEXT PRIMARY KEY,  -- Hash of process fingerprint
  name TEXT NOT NULL,
  path TEXT,
  file_hash TEXT,
  signature TEXT,
  publisher TEXT,
  version TEXT,

  -- Classification
  classification TEXT,  -- game, browser, productivity, social, etc.
  classification_source TEXT,  -- 'allow2_api', 'parent_override', 'plugin_suggestion'
  classified_at DATETIME,

  -- Metadata
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_count INTEGER NOT NULL DEFAULT 1,

  INDEX idx_name (name),
  INDEX idx_classification (classification),
  INDEX idx_last_seen (last_seen)
);

-- Currently running processes (ephemeral)
CREATE TABLE IF NOT EXISTS running_processes (
  process_id TEXT PRIMARY KEY,  -- pid_timestamp
  fingerprint_hash TEXT NOT NULL,
  pid INTEGER NOT NULL,
  started_at DATETIME NOT NULL,
  last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (fingerprint_hash) REFERENCES process_registry(fingerprint_hash)
);

-- Process events waiting to sync
CREATE TABLE IF NOT EXISTS process_event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,  -- 'started', 'stopped', 'classify_request'
  process_id TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  event_data TEXT,  -- JSON
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced BOOLEAN NOT NULL DEFAULT 0,

  INDEX idx_synced (synced),
  INDEX idx_created (created_at)
);

-- Classification requests pending API call
CREATE TABLE IF NOT EXISTS classification_queue (
  fingerprint_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT,
  file_hash TEXT,
  signature TEXT,
  publisher TEXT,
  version TEXT,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry DATETIME,

  INDEX idx_requested (requested_at)
);
```

**Repository Implementation:**

```typescript
// src/core/process-auditor/ProcessRegistry.ts

import Database from 'better-sqlite3';
import * as path from 'path';

export enum ProcessClassification {
  GAME = 'game',
  BROWSER = 'browser',
  SOCIAL_MEDIA = 'social_media',
  PRODUCTIVITY = 'productivity',
  DEVELOPMENT = 'development',
  COMMUNICATION = 'communication',
  MEDIA = 'media',
  UTILITY = 'utility',
  SYSTEM = 'system',
  UNKNOWN = 'unknown'
}

interface ProcessRegistryEntry {
  fingerprintHash: string;
  name: string;
  path: string | null;
  fileHash: string | null;
  signature: string | null;
  publisher: string | null;
  version: string | null;
  classification: ProcessClassification | null;
  classificationSource: 'allow2_api' | 'parent_override' | 'plugin_suggestion' | null;
  classifiedAt: Date | null;
  firstSeen: Date;
  lastSeen: Date;
  seenCount: number;
}

class ProcessRegistry {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initializeSchema();
  }

  private initializeSchema(): void {
    const schema = `
      CREATE TABLE IF NOT EXISTS process_registry (
        fingerprint_hash TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        file_hash TEXT,
        signature TEXT,
        publisher TEXT,
        version TEXT,
        classification TEXT,
        classification_source TEXT,
        classified_at DATETIME,
        first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        seen_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_name ON process_registry(name);
      CREATE INDEX IF NOT EXISTS idx_classification ON process_registry(classification);

      CREATE TABLE IF NOT EXISTS running_processes (
        process_id TEXT PRIMARY KEY,
        fingerprint_hash TEXT NOT NULL,
        pid INTEGER NOT NULL,
        started_at DATETIME NOT NULL,
        last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (fingerprint_hash) REFERENCES process_registry(fingerprint_hash)
      );

      CREATE TABLE IF NOT EXISTS process_event_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        process_id TEXT NOT NULL,
        fingerprint_hash TEXT NOT NULL,
        event_data TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        synced BOOLEAN NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_synced ON process_event_queue(synced);

      CREATE TABLE IF NOT EXISTS classification_queue (
        fingerprint_hash TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT,
        file_hash TEXT,
        signature TEXT,
        publisher TEXT,
        version TEXT,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_retry DATETIME
      );
    `;

    this.db.exec(schema);
  }

  /**
   * Register or update a process fingerprint
   */
  registerProcess(fingerprint: ProcessFingerprint, fingerprintHash: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO process_registry (
        fingerprint_hash, name, path, file_hash, signature, publisher, version,
        first_seen, last_seen, seen_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(fingerprint_hash) DO UPDATE SET
        last_seen = CURRENT_TIMESTAMP,
        seen_count = seen_count + 1
    `);

    stmt.run(
      fingerprintHash,
      fingerprint.name,
      fingerprint.path || null,
      fingerprint.fileHash || null,
      fingerprint.signature || null,
      fingerprint.publisher || null,
      fingerprint.version || null
    );
  }

  /**
   * Get classification for a process
   */
  getClassification(fingerprintHash: string): ProcessClassification | null {
    const stmt = this.db.prepare(`
      SELECT classification FROM process_registry
      WHERE fingerprint_hash = ?
    `);

    const row = stmt.get(fingerprintHash) as { classification: string | null } | undefined;
    return row?.classification as ProcessClassification || null;
  }

  /**
   * Update classification for a process
   */
  updateClassification(
    fingerprintHash: string,
    classification: ProcessClassification,
    source: 'allow2_api' | 'parent_override' | 'plugin_suggestion'
  ): void {
    const stmt = this.db.prepare(`
      UPDATE process_registry
      SET classification = ?,
          classification_source = ?,
          classified_at = CURRENT_TIMESTAMP
      WHERE fingerprint_hash = ?
    `);

    stmt.run(classification, source, fingerprintHash);
  }

  /**
   * Add running process
   */
  addRunningProcess(
    processId: string,
    fingerprintHash: string,
    pid: number,
    startedAt: Date
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO running_processes (
        process_id, fingerprint_hash, pid, started_at, last_updated
      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    stmt.run(processId, fingerprintHash, pid, startedAt.toISOString());
  }

  /**
   * Remove running process
   */
  removeRunningProcess(processId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM running_processes WHERE process_id = ?
    `);

    stmt.run(processId);
  }

  /**
   * Get all currently running processes
   */
  getRunningProcesses(): Array<{
    processId: string;
    fingerprintHash: string;
    classification: ProcessClassification | null;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        rp.process_id,
        rp.fingerprint_hash,
        pr.classification
      FROM running_processes rp
      LEFT JOIN process_registry pr ON rp.fingerprint_hash = pr.fingerprint_hash
    `);

    return stmt.all() as Array<{
      processId: string;
      fingerprintHash: string;
      classification: ProcessClassification | null;
    }>;
  }

  /**
   * Queue process event for sync
   */
  queueEvent(
    eventType: 'started' | 'stopped' | 'classify_request',
    processId: string,
    fingerprintHash: string,
    eventData: any = null
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO process_event_queue (
        event_type, process_id, fingerprint_hash, event_data
      ) VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      eventType,
      processId,
      fingerprintHash,
      eventData ? JSON.stringify(eventData) : null
    );
  }

  /**
   * Get pending events to sync
   */
  getPendingEvents(): Array<{
    id: number;
    eventType: string;
    processId: string;
    fingerprintHash: string;
    eventData: any;
    createdAt: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM process_event_queue
      WHERE synced = 0
      ORDER BY created_at ASC
      LIMIT 100
    `);

    const events = stmt.all() as Array<{
      id: number;
      event_type: string;
      process_id: string;
      fingerprint_hash: string;
      event_data: string | null;
      created_at: string;
    }>;

    return events.map(e => ({
      id: e.id,
      eventType: e.event_type,
      processId: e.process_id,
      fingerprintHash: e.fingerprint_hash,
      eventData: e.event_data ? JSON.parse(e.event_data) : null,
      createdAt: e.created_at
    }));
  }

  /**
   * Mark events as synced
   */
  markEventsSynced(eventIds: number[]): void {
    const placeholders = eventIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      UPDATE process_event_queue
      SET synced = 1
      WHERE id IN (${placeholders})
    `);

    stmt.run(...eventIds);
  }

  /**
   * Add to classification queue
   */
  queueForClassification(
    fingerprint: ProcessFingerprint,
    fingerprintHash: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO classification_queue (
        fingerprint_hash, name, path, file_hash, signature, publisher, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      fingerprintHash,
      fingerprint.name,
      fingerprint.path || null,
      fingerprint.fileHash || null,
      fingerprint.signature || null,
      fingerprint.publisher || null,
      fingerprint.version || null
    );
  }

  /**
   * Get processes needing classification
   */
  getClassificationQueue(): Array<{
    fingerprintHash: string;
    name: string;
    path: string | null;
    fileHash: string | null;
    signature: string | null;
    publisher: string | null;
    version: string | null;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM classification_queue
      WHERE retry_count < 3
      ORDER BY requested_at ASC
      LIMIT 20
    `);

    return stmt.all() as Array<{
      fingerprintHash: string;
      name: string;
      path: string | null;
      fileHash: string | null;
      signature: string | null;
      publisher: string | null;
      version: string | null;
    }>;
  }

  /**
   * Remove from classification queue
   */
  removeFromClassificationQueue(fingerprintHash: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM classification_queue WHERE fingerprint_hash = ?
    `);

    stmt.run(fingerprintHash);
  }

  /**
   * Query processes by classification
   */
  getProcessesByClassification(
    classification: ProcessClassification
  ): ProcessRegistryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM process_registry
      WHERE classification = ?
      ORDER BY last_seen DESC
    `);

    return stmt.all(classification) as ProcessRegistryEntry[];
  }

  close(): void {
    this.db.close();
  }
}
```

#### 5. Classification Manager

**Classification Workflow:**

The Classification Manager handles the intelligent classification of processes through a multi-tier approach:
1. **Local Cache Check** - Fastest, uses SQLite registry
2. **Allow2 API Classification** - Cloud-based ML classification service
3. **Parent Override** - Manual classification by parent user
4. **Plugin Suggestions** - Community-driven classifications

**Allow2 API Integration:**

```typescript
// src/core/process-auditor/ClassificationManager.ts

interface ClassificationRequest {
  fingerprintHash: string;
  name: string;
  path: string | null;
  fileHash: string | null;
  signature: string | null;
  publisher: string | null;
  version: string | null;
}

interface ClassificationResponse {
  fingerprintHash: string;
  classification: ProcessClassification;
  confidence: number; // 0-1
  source: 'database' | 'ml_model' | 'community';
  suggestedBy?: string; // Plugin ID if community suggestion
}

class ClassificationManager {
  constructor(
    private registry: ProcessRegistry,
    private apiClient: Allow2ApiClient,
    private logger: Logger
  ) {}

  /**
   * Classify a process (check cache first, then API)
   */
  async classifyProcess(
    fingerprint: ProcessFingerprint,
    fingerprintHash: string
  ): Promise<ProcessClassification> {
    // Check local cache first
    const cachedClassification = this.registry.getClassification(fingerprintHash);
    if (cachedClassification) {
      return cachedClassification;
    }

    // Check if already queued for classification
    // If not, queue it and return UNKNOWN for now
    this.registry.queueForClassification(fingerprint, fingerprintHash);

    return ProcessClassification.UNKNOWN;
  }

  /**
   * Process classification queue (called periodically)
   */
  async processClassificationQueue(): Promise<void> {
    const queue = this.registry.getClassificationQueue();

    if (queue.length === 0) return;

    this.logger.info(`Processing ${queue.length} classification requests`);

    // Batch requests to Allow2 API
    try {
      const responses = await this.apiClient.classifyProcesses(queue);

      for (const response of responses) {
        // Update local registry
        this.registry.updateClassification(
          response.fingerprintHash,
          response.classification,
          'allow2_api'
        );

        // Remove from queue
        this.registry.removeFromClassificationQueue(response.fingerprintHash);

        this.logger.debug('Process classified', {
          hash: response.fingerprintHash,
          classification: response.classification,
          confidence: response.confidence
        });
      }
    } catch (error) {
      this.logger.error('Classification API request failed', { error });
      // Requests remain in queue for retry
    }
  }

  /**
   * Apply classification from parent (override)
   */
  applyParentOverride(
    fingerprintHash: string,
    classification: ProcessClassification
  ): void {
    this.registry.updateClassification(
      fingerprintHash,
      classification,
      'parent_override'
    );

    this.logger.info('Parent override applied', {
      hash: fingerprintHash,
      classification
    });
  }

  /**
   * Submit plugin classification suggestion
   */
  async submitPluginSuggestion(
    fingerprintHash: string,
    classification: ProcessClassification,
    pluginId: string
  ): Promise<void> {
    try {
      // Send to Allow2 API
      await this.apiClient.suggestClassification({
        fingerprintHash,
        classification,
        suggestedBy: pluginId
      });

      // Update local registry
      this.registry.updateClassification(
        fingerprintHash,
        classification,
        'plugin_suggestion'
      );

      this.logger.info('Plugin suggestion submitted', {
        hash: fingerprintHash,
        classification,
        plugin: pluginId
      });
    } catch (error) {
      this.logger.error('Failed to submit plugin suggestion', { error });
    }
  }
}
```

**Allow2 API Client:**

```typescript
// src/core/process-auditor/Allow2ApiClient.ts

interface Allow2Config {
  apiUrl: string;
  agentId: string;
  apiKey: string;
}

class Allow2ApiClient {
  constructor(private config: Allow2Config) {}

  /**
   * Batch classify processes
   */
  async classifyProcesses(
    requests: ClassificationRequest[]
  ): Promise<ClassificationResponse[]> {
    const response = await fetch(
      `${this.config.apiUrl}/api/v1/processes/classify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': this.config.agentId,
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({ processes: requests })
      }
    );

    if (!response.ok) {
      throw new Error(`Classification API error: ${response.status}`);
    }

    const data = await response.json();
    return data.classifications;
  }

  /**
   * Submit classification suggestion from plugin
   */
  async suggestClassification(suggestion: {
    fingerprintHash: string;
    classification: ProcessClassification;
    suggestedBy: string;
  }): Promise<void> {
    const response = await fetch(
      `${this.config.apiUrl}/api/v1/processes/suggest`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-ID': this.config.agentId,
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(suggestion)
      }
    );

    if (!response.ok) {
      throw new Error(`Suggestion API error: ${response.status}`);
    }
  }

  /**
   * Receive classification updates from parent
   */
  async syncClassifications(
    since: Date
  ): Promise<Array<{
    fingerprintHash: string;
    classification: ProcessClassification;
    source: 'parent_override' | 'allow2_update';
  }>> {
    const response = await fetch(
      `${this.config.apiUrl}/api/v1/processes/sync?since=${since.toISOString()}`,
      {
        headers: {
          'X-Agent-ID': this.config.agentId,
          'Authorization': `Bearer ${this.config.apiKey}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Sync API error: ${response.status}`);
    }

    const data = await response.json();
    return data.updates;
  }
}
```

#### 6. Main Process Auditor

**Orchestration:**

```typescript
// src/core/process-auditor/ProcessAuditor.ts

interface ProcessAuditorConfig {
  scanInterval: number; // milliseconds
  classificationInterval: number; // milliseconds
  dbPath: string;
  allow2Config: Allow2Config;
}

class ProcessAuditor {
  private monitor: ProcessMonitor;
  private fingerprinter: ProcessFingerprinter;
  private deltaCalculator: DeltaCalculator;
  private registry: ProcessRegistry;
  private classificationManager: ClassificationManager;
  private logger: Logger;

  private scanTimer: NodeJS.Timeout | null = null;
  private classificationTimer: NodeJS.Timeout | null = null;

  constructor(private config: ProcessAuditorConfig) {
    // Initialize platform-specific monitor
    if (process.platform === 'win32') {
      this.monitor = new WindowsProcessMonitor();
    } else if (process.platform === 'darwin') {
      this.monitor = new MacOSProcessMonitor();
    } else {
      this.monitor = new LinuxProcessMonitor();
    }

    this.fingerprinter = new ProcessFingerprinter();
    this.deltaCalculator = new DeltaCalculator();
    this.registry = new ProcessRegistry(config.dbPath);

    const apiClient = new Allow2ApiClient(config.allow2Config);
    this.classificationManager = new ClassificationManager(
      this.registry,
      apiClient,
      this.logger
    );
  }

  /**
   * Start continuous process auditing
   */
  start(): void {
    this.logger.info('Starting process auditor');

    // Initial scan
    this.scan().catch(error => {
      this.logger.error('Initial scan failed', { error });
    });

    // Periodic scanning
    this.scanTimer = setInterval(() => {
      this.scan().catch(error => {
        this.logger.error('Scan failed', { error });
      });
    }, this.config.scanInterval);

    // Periodic classification processing
    this.classificationTimer = setInterval(() => {
      this.classificationManager.processClassificationQueue().catch(error => {
        this.logger.error('Classification processing failed', { error });
      });
    }, this.config.classificationInterval);
  }

  /**
   * Stop process auditing
   */
  stop(): void {
    this.logger.info('Stopping process auditor');

    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (this.classificationTimer) {
      clearInterval(this.classificationTimer);
      this.classificationTimer = null;
    }

    this.registry.close();
  }

  /**
   * Perform a process scan
   */
  private async scan(): Promise<void> {
    const startTime = Date.now();

    try {
      // Get running processes
      const processes = await this.monitor.getRunningProcesses();

      // Fingerprint each process
      const fingerprints = await Promise.all(
        processes.map(async proc => {
          const fingerprint = await this.fingerprinter.fingerprint(proc);
          const fingerprintHash = this.fingerprinter.generateFingerprintHash(fingerprint);

          // Register in local database
          this.registry.registerProcess(fingerprint, fingerprintHash);

          // Add to running processes
          this.registry.addRunningProcess(
            fingerprint.processId,
            fingerprintHash,
            proc.pid,
            proc.startTime
          );

          // Classify if needed
          await this.classificationManager.classifyProcess(
            fingerprint,
            fingerprintHash
          );

          return fingerprint;
        })
      );

      // Calculate delta
      const delta = this.deltaCalculator.calculateDelta(fingerprints);

      // Queue events for sync
      delta.started.forEach(fingerprint => {
        const fingerprintHash = this.fingerprinter.generateFingerprintHash(fingerprint);
        this.registry.queueEvent('started', fingerprint.processId, fingerprintHash, {
          name: fingerprint.name,
          path: fingerprint.path,
          publisher: fingerprint.publisher,
          version: fingerprint.version
        });
      });

      delta.stopped.forEach(fingerprint => {
        const fingerprintHash = this.fingerprinter.generateFingerprintHash(fingerprint);
        this.registry.queueEvent('stopped', fingerprint.processId, fingerprintHash);
        this.registry.removeRunningProcess(fingerprint.processId);
      });

      const scanTime = Date.now() - startTime;

      this.logger.debug('Process scan complete', {
        totalProcesses: processes.length,
        started: delta.started.length,
        stopped: delta.stopped.length,
        scanTimeMs: scanTime
      });
    } catch (error) {
      this.logger.error('Process scan failed', { error });
    }
  }

  /**
   * Get pending events for heartbeat sync
   */
  getPendingEvents(): Array<any> {
    return this.registry.getPendingEvents();
  }

  /**
   * Mark events as synced after successful heartbeat
   */
  markEventsSynced(eventIds: number[]): void {
    this.registry.markEventsSynced(eventIds);
  }

  /**
   * Query running processes by classification
   */
  getRunningProcessesByClassification(
    classification: ProcessClassification
  ): Array<{
    processId: string;
    fingerprintHash: string;
  }> {
    const running = this.registry.getRunningProcesses();
    return running.filter(p => p.classification === classification);
  }

  /**
   * Check if a specific process is running
   */
  isProcessRunning(fingerprintHash: string): boolean {
    const running = this.registry.getRunningProcesses();
    return running.some(p => p.fingerprintHash === fingerprintHash);
  }

  /**
   * Apply classification override from parent
   */
  applyClassificationOverride(
    fingerprintHash: string,
    classification: ProcessClassification
  ): void {
    this.classificationManager.applyParentOverride(fingerprintHash, classification);
  }
}

export default ProcessAuditor;
```

### Classification System

The Process Auditing System includes a sophisticated classification mechanism that automatically categorizes processes to help plugins make intelligent decisions.

#### Classification Categories

Processes are classified into the following categories:

| Category | Description | Examples |
|----------|-------------|----------|
| `game` | Gaming applications and platforms | Steam, Epic Games, Minecraft, Fortnite |
| `browser` | Web browsers | Chrome, Firefox, Safari, Edge |
| `social_media` | Social media applications | Discord, Slack, Teams, Facebook Messenger |
| `productivity` | Productivity tools | Microsoft Office, Google Workspace, Notion |
| `development` | Development tools and IDEs | VS Code, IntelliJ IDEA, Docker, Git |
| `communication` | Communication apps | Zoom, Skype, WhatsApp |
| `media` | Media players and streaming | Spotify, VLC, Netflix, YouTube Desktop |
| `utility` | System utilities | 7-Zip, WinRAR, Task Manager |
| `system` | Operating system processes | Windows Services, macOS daemons, Linux systemd |
| `unknown` | Unclassified processes | New or custom applications |

#### Classification Workflow

**Step 1: Process Discovery**
```
Agent detects new process → Generate fingerprint → Check local registry
```

**Step 2: Local Cache Lookup**
```typescript
// Check if we've seen this process before
const cachedClassification = registry.getClassification(fingerprintHash);
if (cachedClassification) {
  return cachedClassification; // Fast path
}
```

**Step 3: Queue for Classification**
```typescript
// Unknown process - queue for API classification
registry.queueForClassification(fingerprint, fingerprintHash);
// Return UNKNOWN temporarily until classified
return ProcessClassification.UNKNOWN;
```

**Step 4: Batch API Classification**
```typescript
// Periodically process classification queue
const queue = registry.getClassificationQueue();
const responses = await allow2ApiClient.classifyProcesses(queue);

for (const response of responses) {
  registry.updateClassification(
    response.fingerprintHash,
    response.classification,
    'allow2_api'
  );
}
```

**Step 5: Classification Updates from Allow2 Platform**
```typescript
// Classifications are managed by parent users through the Allow2 platform.
// The agent periodically syncs classification updates from the platform.
const updates = await allow2Client.syncClassifications(lastSyncTimestamp);
for (const update of updates) {
  registry.updateClassification(
    update.fingerprintHash,
    update.classification,
    'allow2_platform'
  );
}
```

> **Note:** All process classifications are managed centrally through the **Allow2 platform and apps**.
> Parents configure and override classifications through the Allow2 user interface, not locally on the
> allow2automate parent app or agent. The Allow2 platform is the source of truth for all classifications.

#### Classification Priority

Process classifications come from a single authoritative source:

1. **Allow2 Platform** - All classifications are managed through the Allow2 platform
   - Initial ML-based classification from cloud service
   - Parent user overrides via Allow2 apps/web interface
   - Community-contributed classifications (reviewed by Allow2)
2. **Unknown** - Default for unclassified processes (until classified by Allow2 platform)

```typescript
// Classification resolution logic
function resolveClassification(registry: ProcessRegistry, hash: string): ProcessClassification {
  const entry = registry.getEntry(hash);

  // Allow2 platform is the single source of truth
  if (entry.classificationSource === 'allow2_platform' && entry.classification) {
    return entry.classification;
  }

  // Default: Unknown (will be classified when synced with Allow2 platform)
  return ProcessClassification.UNKNOWN;
}
```

### Database Schema

The Process Auditing System uses SQLite for local data storage with a carefully designed schema optimized for performance and delta-based synchronization.

#### Complete Schema Definition

```sql
-- src/core/process-auditor/schema.sql

-- ============================================================
-- PROCESS REGISTRY
-- Stores known process fingerprints and their classifications
-- ============================================================
CREATE TABLE IF NOT EXISTS process_registry (
  -- Primary identification
  fingerprint_hash TEXT PRIMARY KEY,  -- SHA-256 hash of process fingerprint

  -- Process metadata
  name TEXT NOT NULL,                 -- Process name (e.g., chrome.exe)
  path TEXT,                          -- Full executable path
  file_hash TEXT,                     -- SHA-256 hash of executable file
  signature TEXT,                     -- Digital signature info
  publisher TEXT,                     -- Publisher/Developer name
  version TEXT,                       -- Application version

  -- Classification data
  classification TEXT,                -- Category (game, browser, etc.)
  classification_source TEXT,         -- Source of classification
                                      -- Values: 'allow2_platform' (single source of truth)
  classified_at DATETIME,             -- When classification was applied

  -- Tracking metadata
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen_count INTEGER NOT NULL DEFAULT 1,

  -- Indexes for performance
  INDEX idx_name (name),
  INDEX idx_classification (classification),
  INDEX idx_last_seen (last_seen)
);

-- ============================================================
-- RUNNING PROCESSES
-- Ephemeral table of currently running processes
-- Cleared and rebuilt on each scan
-- ============================================================
CREATE TABLE IF NOT EXISTS running_processes (
  -- Unique process instance identifier
  process_id TEXT PRIMARY KEY,        -- Format: {pid}_{startTimestamp}

  -- Reference to process registry
  fingerprint_hash TEXT NOT NULL,     -- Links to process_registry

  -- Runtime information
  pid INTEGER NOT NULL,               -- Operating system process ID
  started_at DATETIME NOT NULL,       -- When process started
  last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (fingerprint_hash) REFERENCES process_registry(fingerprint_hash)
);

-- ============================================================
-- PROCESS EVENT QUEUE
-- Delta events waiting to be synced to parent
-- Batch sent with heartbeat
-- ============================================================
CREATE TABLE IF NOT EXISTS process_event_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Event metadata
  event_type TEXT NOT NULL,           -- 'started', 'stopped', 'classify_request'
  process_id TEXT NOT NULL,           -- Process instance identifier
  fingerprint_hash TEXT NOT NULL,     -- Links to process_registry

  -- Event payload
  event_data TEXT,                    -- JSON payload with additional data

  -- Sync tracking
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced BOOLEAN NOT NULL DEFAULT 0,  -- 0 = pending, 1 = synced

  -- Indexes for efficient querying
  INDEX idx_synced (synced),
  INDEX idx_created (created_at)
);

-- ============================================================
-- CLASSIFICATION QUEUE
-- Processes waiting for classification from Allow2 API
-- Batched and sent periodically
-- ============================================================
CREATE TABLE IF NOT EXISTS classification_queue (
  fingerprint_hash TEXT PRIMARY KEY,  -- Ensures one request per process

  -- Process details for classification
  name TEXT NOT NULL,
  path TEXT,
  file_hash TEXT,
  signature TEXT,
  publisher TEXT,
  version TEXT,

  -- Request tracking
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry DATETIME,

  -- Index for retry logic
  INDEX idx_requested (requested_at)
);
```

#### Parent-Side Database Schema

```sql
-- Parent application database
-- Stores process information aggregated from all agents

-- ============================================================
-- AGENT PROCESSES
-- Process events received from agents
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_processes (
  id TEXT PRIMARY KEY,                -- UUID for event
  agent_id TEXT NOT NULL,             -- Which agent reported this

  -- Process identification
  process_id TEXT NOT NULL,           -- Process instance ID from agent
  fingerprint_hash TEXT NOT NULL,     -- Process fingerprint hash
  process_name TEXT NOT NULL,

  -- Classification
  classification TEXT,                -- Current classification

  -- Event tracking
  event_type TEXT NOT NULL,           -- 'started' or 'stopped'
  event_timestamp DATETIME NOT NULL,  -- When event occurred
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_agent_id (agent_id),
  INDEX idx_fingerprint (fingerprint_hash),
  INDEX idx_event_timestamp (event_timestamp)
);

-- ============================================================
-- PROCESS CLASSIFICATIONS
-- Master classification database
-- Combines Allow2 API + parent overrides + plugin suggestions
-- ============================================================
CREATE TABLE IF NOT EXISTS process_classifications (
  fingerprint_hash TEXT PRIMARY KEY,

  -- Process metadata
  process_name TEXT NOT NULL,
  publisher TEXT,

  -- Classification data
  classification TEXT NOT NULL,
  classification_source TEXT NOT NULL,  -- 'allow2_api', 'parent_override', 'plugin_suggestion'
  confidence REAL,                      -- 0.0 to 1.0 (for ML classifications)

  -- Override tracking
  original_classification TEXT,         -- Original before parent override
  overridden_by_user_id TEXT,          -- Which parent user made override
  overridden_at DATETIME,

  -- Community data
  plugin_suggestions JSON,              -- Array of plugin suggestions
  community_votes INTEGER DEFAULT 0,    -- Upvotes for this classification

  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Indexes
  INDEX idx_classification (classification),
  INDEX idx_source (classification_source),
  INDEX idx_process_name (process_name)
);

-- ============================================================
-- CLASSIFICATION HISTORY
-- Audit trail of classification changes
-- ============================================================
CREATE TABLE IF NOT EXISTS classification_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint_hash TEXT NOT NULL,

  -- Change data
  old_classification TEXT,
  new_classification TEXT,
  source TEXT NOT NULL,
  changed_by_user_id TEXT,

  -- Metadata
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,

  INDEX idx_fingerprint (fingerprint_hash),
  INDEX idx_changed_at (changed_at)
);
```

#### Schema Migration Example

```typescript
// src/core/process-auditor/migrations/001_initial.ts

import Database from 'better-sqlite3';

export function migrate(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS process_registry (
      fingerprint_hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT,
      file_hash TEXT,
      signature TEXT,
      publisher TEXT,
      version TEXT,
      classification TEXT,
      classification_source TEXT,
      classified_at DATETIME,
      first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      seen_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_name ON process_registry(name);
    CREATE INDEX IF NOT EXISTS idx_classification ON process_registry(classification);
    CREATE INDEX IF NOT EXISTS idx_last_seen ON process_registry(last_seen);
  `);

  // Add version tracking
  db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)')
    .run(1);
}
```

### API Integration

The Process Auditing System integrates with the Allow2 cloud service for intelligent process classification.

#### Classification API Endpoint

**Request:** `POST /api/v2/classify-processes`

```typescript
interface ClassifyProcessesRequest {
  agent_id: string;
  processes: Array<{
    fingerprint_hash: string;
    name: string;
    path: string | null;
    file_hash: string | null;
    signature: string | null;
    publisher: string | null;
    version: string | null;
  }>;
}
```

**Response:**

```typescript
interface ClassifyProcessesResponse {
  classifications: Array<{
    fingerprint_hash: string;
    classification: ProcessClassification;
    confidence: number; // 0.0 to 1.0
    source: 'database' | 'ml_model' | 'community';
    suggested_by?: string; // Plugin ID if community suggestion
  }>;

  // Additional metadata
  cache_until: string; // ISO timestamp
  api_version: string;
}
```

**Example Request:**

```bash
curl -X POST https://api.allow2.com/api/v2/classify-processes \
  -H "Content-Type: application/json" \
  -H "X-Agent-ID: agent-123" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "agent_id": "agent-123",
    "processes": [
      {
        "fingerprint_hash": "a3b2c1d4e5f6...",
        "name": "steam.exe",
        "path": "C:\\Program Files (x86)\\Steam\\steam.exe",
        "file_hash": "9f8e7d6c5b4a...",
        "signature": "Valve Corporation",
        "publisher": "Valve Corporation",
        "version": "1.0.0.0"
      }
    ]
  }'
```

**Example Response:**

```json
{
  "classifications": [
    {
      "fingerprint_hash": "a3b2c1d4e5f6...",
      "classification": "game",
      "confidence": 0.98,
      "source": "database",
      "metadata": {
        "common_name": "Steam Gaming Platform",
        "category_tags": ["game_launcher", "digital_distribution"]
      }
    }
  ],
  "cache_until": "2026-01-16T12:00:00Z",
  "api_version": "2.0.0"
}
```

#### Sync Classifications API

**Request:** `GET /api/v2/classifications/sync?since={timestamp}`

Retrieves classification updates since the specified timestamp.

```typescript
interface SyncClassificationsRequest {
  agent_id: string;
  since: string; // ISO timestamp
}

interface SyncClassificationsResponse {
  updates: Array<{
    fingerprint_hash: string;
    classification: ProcessClassification;
    source: 'allow2_platform'; // All classifications from Allow2 platform
    updated_at: string;
  }>;
  next_sync_at: string; // When to check again
}
```

#### Error Handling

```typescript
// API client with retry logic
class Allow2ApiClient {
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit,
    retries = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(
          `${this.config.apiUrl}${endpoint}`,
          {
            ...options,
            headers: {
              'Content-Type': 'application/json',
              'X-Agent-ID': this.config.agentId,
              'Authorization': `Bearer ${this.config.apiKey}`,
              ...options.headers
            }
          }
        );

        if (!response.ok) {
          if (response.status === 429) {
            // Rate limited - wait and retry
            await this.exponentialBackoff(attempt);
            continue;
          }

          if (response.status >= 500) {
            // Server error - retry
            await this.exponentialBackoff(attempt);
            continue;
          }

          // Client error - don't retry
          throw new ApiError(response.status, await response.text());
        }

        return await response.json();
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        await this.exponentialBackoff(attempt);
      }
    }

    throw new Error('Max retries exceeded');
  }

  private async exponentialBackoff(attempt: number): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}
```

### Implementation Details

#### Process Hashing Algorithm

The fingerprint hash is calculated using SHA-256 on a combination of process attributes:

```typescript
function generateFingerprintHash(fingerprint: ProcessFingerprint): string {
  const parts = [
    fingerprint.name.toLowerCase(),        // Normalize case
    fingerprint.path.toLowerCase(),        // Normalize path
    fingerprint.fileHash || '',            // Empty if unavailable
    fingerprint.publisher || ''            // Empty if unsigned
  ];

  return crypto
    .createHash('sha256')
    .update(parts.join('|'))              // Use pipe separator
    .digest('hex');
}
```

**Why this approach:**
- **Name + Path**: Same executable in different locations = different hash
- **File Hash**: Detects version changes
- **Publisher**: Distinguishes signed vs unsigned builds
- **Case Insensitive**: Windows is case-insensitive

#### Polling Interval

```typescript
// Recommended polling intervals
const PROCESS_SCAN_INTERVAL = 5000;        // 5 seconds
const CLASSIFICATION_INTERVAL = 30000;     // 30 seconds
const SYNC_CLASSIFICATIONS_INTERVAL = 300000; // 5 minutes

// Adaptive interval based on activity
class AdaptivePoller {
  private scanInterval = 5000;

  adjustInterval(deltaSize: number): void {
    if (deltaSize === 0) {
      // No changes - slow down
      this.scanInterval = Math.min(this.scanInterval * 1.5, 15000);
    } else {
      // Active changes - speed up
      this.scanInterval = Math.max(this.scanInterval * 0.8, 2000);
    }
  }
}
```

#### Delta Queue and Batch Sync

```typescript
// Efficient batch syncing
class EventQueue {
  private queue: ProcessEvent[] = [];
  private readonly BATCH_SIZE = 50;
  private readonly MAX_AGE_MS = 60000; // 1 minute

  async syncWithParent(): Promise<void> {
    const unsyncedEvents = this.getUnsyncedEvents();

    if (unsyncedEvents.length === 0) return;

    // Split into batches
    const batches = this.chunk(unsyncedEvents, this.BATCH_SIZE);

    for (const batch of batches) {
      try {
        await this.apiClient.sendProcessEvents({
          agent_id: this.agentId,
          events: batch
        });

        // Mark as synced
        this.markAsSynced(batch.map(e => e.id));
      } catch (error) {
        this.logger.error('Failed to sync batch', { error, batchSize: batch.length });
        // Events remain in queue for retry
      }
    }
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
```

#### Memory Usage Optimization

```typescript
// Memory-efficient process monitoring
class ProcessMonitorOptimized {
  private readonly HASH_CACHE_SIZE = 1000;
  private readonly HASH_CACHE_TTL = 3600000; // 1 hour
  private hashCache = new LRUCache<string, string>({
    max: this.HASH_CACHE_SIZE,
    ttl: this.HASH_CACHE_TTL
  });

  async getProcessHash(filePath: string): Promise<string | null> {
    // Check cache first
    const cached = this.hashCache.get(filePath);
    if (cached) return cached;

    // Calculate hash (expensive operation)
    const hash = await this.calculateFileHash(filePath);

    if (hash) {
      this.hashCache.set(filePath, hash);
    }

    return hash;
  }

  // Stream-based hashing for large files
  private async calculateFileHash(filePath: string): Promise<string | null> {
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      return new Promise((resolve, reject) => {
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });
    } catch {
      return null;
    }
  }
}
```

### Code Examples

This section provides complete, production-ready code examples for implementing and using the Process Auditing System.

#### Agent-Side: Complete ProcessAuditor Implementation

```typescript
// src/core/process-auditor/index.ts
// Main entry point for Process Auditing System

import { ProcessAuditor } from './ProcessAuditor';
import { ProcessClassification } from './ProcessRegistry';
import { Logger } from '../logger';
import path from 'path';

export interface ProcessAuditingConfig {
  enabled: boolean;
  scanInterval?: number;
  classificationInterval?: number;
  dbPath?: string;
  allow2ApiUrl?: string;
  allow2ApiKey?: string;
  agentId: string;
}

export class ProcessAuditingService {
  private auditor: ProcessAuditor | null = null;
  private logger: Logger;

  constructor(
    private config: ProcessAuditingConfig,
    logger: Logger
  ) {
    this.logger = logger;
  }

  /**
   * Initialize and start process auditing
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Process auditing disabled');
      return;
    }

    this.logger.info('Initializing process auditing system');

    const dbPath = this.config.dbPath || path.join(
      process.env.APPDATA || process.env.HOME || '.',
      'allow2-agent',
      'process-audit.db'
    );

    this.auditor = new ProcessAuditor({
      scanInterval: this.config.scanInterval || 5000,
      classificationInterval: this.config.classificationInterval || 30000,
      dbPath,
      allow2Config: {
        apiUrl: this.config.allow2ApiUrl || 'https://api.allow2.com',
        agentId: this.config.agentId,
        apiKey: this.config.allow2ApiKey || ''
      }
    });

    // Start monitoring
    this.auditor.start();

    this.logger.info('Process auditing system started');
  }

  /**
   * Stop process auditing
   */
  async stop(): Promise<void> {
    if (this.auditor) {
      this.auditor.stop();
      this.logger.info('Process auditing system stopped');
    }
  }

  /**
   * Get pending events for heartbeat sync
   */
  async getPendingEvents(): Promise<ProcessEvent[]> {
    if (!this.auditor) return [];
    return this.auditor.registry.getUnsyncedEvents();
  }

  /**
   * Mark events as synced after successful heartbeat
   */
  async markEventsSynced(eventIds: number[]): Promise<void> {
    if (!this.auditor) return;
    this.auditor.registry.markEventsSynced(eventIds);
  }

  /**
   * Apply classification override from parent
   */
  async applyClassificationOverride(
    fingerprintHash: string,
    classification: ProcessClassification
  ): Promise<void> {
    if (!this.auditor) return;
    this.auditor.applyClassificationOverride(fingerprintHash, classification);
  }

  /**
   * Get currently running processes (for plugin queries)
   */
  getRunningProcesses(filter?: {
    classification?: ProcessClassification;
  }): Array<ProcessInfo> {
    if (!this.auditor) return [];

    if (filter?.classification) {
      return this.auditor.getRunningProcessesByClassification(filter.classification);
    }

    return this.auditor.registry.getRunningProcesses();
  }
}
```

#### Parent-Side: Classification API Implementation

```typescript
// src/services/ProcessClassificationService.ts
// Parent application service for managing process classifications

import { Database } from '../database';
import { Allow2ApiClient } from './Allow2ApiClient';

export class ProcessClassificationService {
  constructor(
    private db: Database,
    private allow2Client: Allow2ApiClient
  ) {}

  /**
   * Handle process events from agent
   */
  async handleProcessEvents(
    agentId: string,
    events: Array<{
      event_type: 'started' | 'stopped';
      process_id: string;
      fingerprint_hash: string;
      process_name: string;
      event_timestamp: string;
    }>
  ): Promise<void> {
    // Store events in database
    for (const event of events) {
      await this.db.query(`
        INSERT INTO agent_processes (
          id, agent_id, process_id, fingerprint_hash, process_name,
          event_type, event_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        this.generateUuid(),
        agentId,
        event.process_id,
        event.fingerprint_hash,
        event.process_name,
        event.event_type,
        event.event_timestamp
      ]);

      // Classify unknown processes
      await this.ensureProcessClassified(event.fingerprint_hash, event.process_name);
    }

    // Notify plugins of process events
    this.notifyPlugins(agentId, events);
  }

  /**
   * Ensure a process has a classification
   */
  private async ensureProcessClassified(
    fingerprintHash: string,
    processName: string
  ): Promise<void> {
    // Check if already classified
    const existing = await this.db.queryOne(`
      SELECT classification FROM process_classifications
      WHERE fingerprint_hash = ?
    `, [fingerprintHash]);

    if (existing) return;

    // Request classification from Allow2 API
    try {
      const classification = await this.allow2Client.classifyProcess({
        fingerprint_hash: fingerprintHash,
        name: processName
      });

      // Store classification
      await this.db.query(`
        INSERT INTO process_classifications (
          fingerprint_hash, process_name, classification,
          classification_source, confidence
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        fingerprintHash,
        processName,
        classification.category,
        'allow2_api',
        classification.confidence
      ]);
    } catch (error) {
      console.error('Failed to classify process:', error);
      // Store as unknown
      await this.db.query(`
        INSERT INTO process_classifications (
          fingerprint_hash, process_name, classification,
          classification_source
        ) VALUES (?, ?, ?, ?)
      `, [fingerprintHash, processName, 'unknown', 'unknown']);
    }
  }

  /**
   * Allow parent to override classification
   */
  async overrideClassification(
    fingerprintHash: string,
    newClassification: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    // Get current classification
    const current = await this.db.queryOne(`
      SELECT classification FROM process_classifications
      WHERE fingerprint_hash = ?
    `, [fingerprintHash]);

    // Update classification
    await this.db.query(`
      UPDATE process_classifications
      SET
        original_classification = COALESCE(original_classification, ?),
        classification = ?,
        classification_source = 'parent_override',
        overridden_by_user_id = ?,
        overridden_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE fingerprint_hash = ?
    `, [current?.classification, newClassification, userId, fingerprintHash]);

    // Record in history
    await this.db.query(`
      INSERT INTO classification_history (
        fingerprint_hash, old_classification, new_classification,
        source, changed_by_user_id, reason
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [
      fingerprintHash,
      current?.classification,
      newClassification,
      'parent_override',
      userId,
      reason
    ]);

    // Sync to agents
    await this.syncClassificationToAgents(fingerprintHash, newClassification);
  }

  /**
   * Get classification for a process
   */
  async getClassification(fingerprintHash: string): Promise<string | null> {
    const result = await this.db.queryOne(`
      SELECT classification FROM process_classifications
      WHERE fingerprint_hash = ?
    `, [fingerprintHash]);

    return result?.classification || null;
  }

  /**
   * Get process activity report for an agent
   */
  async getProcessActivity(
    agentId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ProcessActivityReport> {
    const events = await this.db.query(`
      SELECT
        p.fingerprint_hash,
        p.process_name,
        c.classification,
        p.event_type,
        p.event_timestamp
      FROM agent_processes p
      LEFT JOIN process_classifications c ON p.fingerprint_hash = c.fingerprint_hash
      WHERE p.agent_id = ?
        AND p.event_timestamp >= ?
        AND p.event_timestamp <= ?
      ORDER BY p.event_timestamp
    `, [agentId, startDate.toISOString(), endDate.toISOString()]);

    return this.aggregateProcessActivity(events);
  }

  private aggregateProcessActivity(events: any[]): ProcessActivityReport {
    const sessions: Map<string, ProcessSession> = new Map();
    const byCategory: Map<string, number> = new Map();

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.event_type === 'started') {
        // Find matching stop event
        const stopEvent = events.find(
          e => e.event_type === 'stopped' &&
               e.fingerprint_hash === event.fingerprint_hash &&
               new Date(e.event_timestamp) > new Date(event.event_timestamp)
        );

        if (stopEvent) {
          const duration = new Date(stopEvent.event_timestamp).getTime() -
                          new Date(event.event_timestamp).getTime();

          const category = event.classification || 'unknown';
          byCategory.set(category, (byCategory.get(category) || 0) + duration);

          sessions.set(event.fingerprint_hash, {
            processName: event.process_name,
            classification: category,
            startTime: event.event_timestamp,
            endTime: stopEvent.event_timestamp,
            duration
          });
        }
      }
    }

    return {
      totalTime: Array.from(byCategory.values()).reduce((a, b) => a + b, 0),
      byCategory: Object.fromEntries(byCategory),
      sessions: Array.from(sessions.values()),
      startDate: events[0]?.event_timestamp,
      endDate: events[events.length - 1]?.event_timestamp
    };
  }

  private async syncClassificationToAgents(
    fingerprintHash: string,
    classification: string
  ): Promise<void> {
    // Implementation to notify all agents about classification change
    // This would use the agent communication system
  }

  private notifyPlugins(agentId: string, events: any[]): void {
    // Emit events for plugins to consume
    // Implementation depends on plugin system
  }

  private generateUuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
```

#### Plugin Example: Browser Time Monitoring

```typescript
// plugins/browser-monitor/BrowserMonitorPlugin.ts
// Example plugin using process auditing for browser detection

import { Plugin, PluginContext } from '../../plugin-sdk';
import { ProcessClassification } from '../../core/process-auditor';

export class BrowserMonitorPlugin implements Plugin {
  id = 'browser-monitor';
  name = 'Browser Time Monitor';
  version = '1.0.0';

  private browserSessions = new Map<string, BrowserSession>();
  private dailyUsageMinutes = 0;

  async initialize(context: PluginContext): Promise<void> {
    // Subscribe to process events
    context.on('process:started', (event) => {
      if (event.classification === ProcessClassification.BROWSER) {
        this.onBrowserStarted(event);
      }
    });

    context.on('process:stopped', (event) => {
      if (event.classification === ProcessClassification.BROWSER) {
        this.onBrowserStopped(event);
      }
    });

    // Check if any browsers are already running
    const runningBrowsers = context.processAuditor.getRunningProcesses({
      classification: ProcessClassification.BROWSER
    });

    for (const browser of runningBrowsers) {
      this.onBrowserStarted({
        processId: browser.process_id,
        fingerprintHash: browser.fingerprint_hash,
        processName: browser.name,
        classification: ProcessClassification.BROWSER,
        timestamp: browser.started_at
      });
    }
  }

  private onBrowserStarted(event: ProcessEvent): void {
    this.browserSessions.set(event.processId, {
      processId: event.processId,
      processName: event.processName,
      startTime: new Date(event.timestamp),
      fingerprintHash: event.fingerprintHash
    });

    console.log(`Browser started: ${event.processName}`);
  }

  private onBrowserStopped(event: ProcessEvent): void {
    const session = this.browserSessions.get(event.processId);
    if (!session) return;

    const duration = Date.now() - session.startTime.getTime();
    const minutes = Math.floor(duration / 60000);

    this.dailyUsageMinutes += minutes;
    this.browserSessions.delete(event.processId);

    console.log(`Browser stopped: ${event.processName}, Duration: ${minutes}min`);

    // Check if daily limit exceeded
    if (this.dailyUsageMinutes > this.getDailyLimit()) {
      this.notifyLimitExceeded();
    }
  }

  private getDailyLimit(): number {
    // Get from plugin config or quota system
    return 120; // 2 hours default
  }

  private notifyLimitExceeded(): void {
    // Send notification to parent
    console.warn('Browser time limit exceeded for today');
  }

  async cleanup(): Promise<void> {
    this.browserSessions.clear();
  }
}
```

#### Plugin Example: Gaming Monitor with Classification Suggestions

```typescript
// plugins/gaming-monitor/GamingMonitorPlugin.ts
// Advanced plugin that suggests process classifications

import { Plugin, PluginContext } from '../../plugin-sdk';
import { ProcessClassification } from '../../core/process-auditor';

export class GamingMonitorPlugin implements Plugin {
  id = 'gaming-monitor';
  name = 'Gaming Monitor';
  version = '1.0.0';

  private knownGamePublishers = [
    'Valve Corporation',
    'Epic Games',
    'Electronic Arts',
    'Activision',
    'Ubisoft',
    'Riot Games'
  ];

  private knownGameProcessNames = [
    'steam.exe',
    'epicgameslauncher.exe',
    'origin.exe',
    'battle.net.exe',
    'riotclientservices.exe',
    'minecraft.exe',
    'fortnite.exe'
  ];

  async initialize(context: PluginContext): Promise<void> {
    // Monitor all processes, suggest classifications for games
    context.on('process:started', async (event) => {
      // Skip already classified processes
      if (event.classification && event.classification !== ProcessClassification.UNKNOWN) {
        return;
      }

      // Check if this looks like a game
      if (this.looksLikeGame(event)) {
        await this.suggestGameClassification(context, event);
      }

      // Track classified games
      if (event.classification === ProcessClassification.GAME) {
        this.onGameStarted(event);
      }
    });

    context.on('process:stopped', (event) => {
      if (event.classification === ProcessClassification.GAME) {
        this.onGameStopped(event);
      }
    });
  }

  private looksLikeGame(event: ProcessEvent): boolean {
    const name = event.processName.toLowerCase();
    const publisher = event.publisher?.toLowerCase() || '';

    // Check known game process names
    if (this.knownGameProcessNames.some(game => name.includes(game))) {
      return true;
    }

    // Check known game publishers
    if (this.knownGamePublishers.some(pub => publisher.includes(pub.toLowerCase()))) {
      return true;
    }

    // Heuristic: processes in "Program Files/Games" or "Steam/steamapps"
    const path = event.path?.toLowerCase() || '';
    if (path.includes('\\games\\') || path.includes('\\steamapps\\')) {
      return true;
    }

    return false;
  }

  private async suggestGameClassification(
    context: PluginContext,
    event: ProcessEvent
  ): Promise<void> {
    try {
      await context.processAuditor.suggestClassification(
        event.fingerprintHash,
        ProcessClassification.GAME,
        this.id,
        {
          confidence: 0.85,
          reason: 'Detected by gaming monitor plugin',
          evidence: this.getEvidence(event)
        }
      );

      console.log(`Suggested game classification for: ${event.processName}`);
    } catch (error) {
      console.error('Failed to suggest classification:', error);
    }
  }

  private getEvidence(event: ProcessEvent): string[] {
    const evidence: string[] = [];

    if (this.knownGameProcessNames.some(g => event.processName.toLowerCase().includes(g))) {
      evidence.push('known_game_process_name');
    }

    if (event.publisher && this.knownGamePublishers.includes(event.publisher)) {
      evidence.push('known_game_publisher');
    }

    if (event.path?.toLowerCase().includes('\\steamapps\\')) {
      evidence.push('steam_library_path');
    }

    return evidence;
  }

  private onGameStarted(event: ProcessEvent): void {
    console.log(`Game started: ${event.processName}`);
    // Track game session
  }

  private onGameStopped(event: ProcessEvent): void {
    console.log(`Game stopped: ${event.processName}`);
    // End game session tracking
  }

  async cleanup(): Promise<void> {
    // Cleanup resources
  }
}
```

These code examples demonstrate:
- **Agent-side**: Complete ProcessAuditor service integration
- **Parent-side**: Classification management and reporting
- **Plugin examples**: Real-world usage for browser and gaming monitoring
- **Classification suggestions**: How plugins can contribute to community classifications

### Plugin Integration

**How Plugins Consume Process Data:**

```typescript
// src/PluginExtensionManager.ts (extension)

class PluginExtensionManager {
  constructor(private processAuditor: ProcessAuditor) {
    // Subscribe to process events
    this.subscribeToProcessEvents();
  }

  private subscribeToProcessEvents(): void {
    // Plugins can register interest in specific classifications
    this.on('process:started', (event) => {
      // Notify interested plugins
      this.plugins.forEach(plugin => {
        if (plugin.interestedInProcesses) {
          plugin.onProcessStarted(event);
        }
      });
    });

    this.on('process:stopped', (event) => {
      this.plugins.forEach(plugin => {
        if (plugin.interestedInProcesses) {
          plugin.onProcessStopped(event);
        }
      });
    });
  }

  /**
   * Plugin API: Query running processes
   */
  getRunningProcesses(
    filter?: { classification?: ProcessClassification }
  ): Array<ProcessInfo> {
    if (filter?.classification) {
      return this.processAuditor.getRunningProcessesByClassification(
        filter.classification
      );
    }

    return this.processAuditor.registry.getRunningProcesses();
  }

  /**
   * Plugin API: Check if specific process is running
   */
  isProcessRunning(fingerprintHash: string): boolean {
    return this.processAuditor.isProcessRunning(fingerprintHash);
  }

  /**
   * Plugin API: Suggest classification
   */
  async suggestProcessClassification(
    fingerprintHash: string,
    classification: ProcessClassification,
    pluginId: string
  ): Promise<void> {
    await this.processAuditor.classificationManager.submitPluginSuggestion(
      fingerprintHash,
      classification,
      pluginId
    );
  }
}
```

### Example Plugin Using Process Data

**Game Monitor Plugin:**

```typescript
// plugins/game-monitor/monitors/game-detector.ts

module.exports = {
  id: 'game-detector',
  interval: 60000, // Check every minute
  platforms: ['win32', 'darwin', 'linux'],
  interestedInProcesses: true, // Enable process event notifications

  // Called when plugin initializes
  async init(pluginApi) {
    // Query currently running game processes
    const games = pluginApi.getRunningProcesses({
      classification: 'game'
    });

    return {
      currentGames: games.length,
      gamesList: games.map(g => ({
        name: g.name,
        startedAt: g.startedAt
      }))
    };
  },

  // Called when a process starts
  async onProcessStarted(event) {
    const { classification, name, fingerprintHash } = event;

    if (classification === 'game') {
      // Game started - begin tracking playtime
      return {
        eventType: 'game_started',
        gameName: name,
        fingerprintHash,
        timestamp: Date.now()
      };
    }
  },

  // Called when a process stops
  async onProcessStopped(event) {
    const { classification, name, fingerprintHash, duration } = event;

    if (classification === 'game') {
      // Game stopped - record playtime
      return {
        eventType: 'game_stopped',
        gameName: name,
        fingerprintHash,
        playDurationSeconds: duration,
        timestamp: Date.now()
      };
    }
  },

  // Periodic check (runs at interval)
  async execute(pluginApi) {
    // Check for unknown gaming processes
    const unknownProcesses = pluginApi.getRunningProcesses({
      classification: 'unknown'
    });

    // Apply heuristics to suggest game classification
    const gameLikeProcesses = unknownProcesses.filter(p => {
      const name = p.name.toLowerCase();
      return (
        name.includes('game') ||
        name.includes('steam') ||
        name.includes('epic') ||
        name.includes('launcher')
      );
    });

    // Suggest classifications
    for (const process of gameLikeProcesses) {
      await pluginApi.suggestProcessClassification(
        process.fingerprintHash,
        'game',
        'game-monitor-v1'
      );
    }

    // Return current gaming status
    const games = pluginApi.getRunningProcesses({
      classification: 'game'
    });

    return {
      activeGames: games.length,
      totalPlaytime: this.calculateTotalPlaytime(games),
      games: games.map(g => ({
        name: g.name,
        duration: Date.now() - g.startedAt
      }))
    };
  },

  calculateTotalPlaytime(games) {
    return games.reduce((total, game) => {
      return total + (Date.now() - game.startedAt);
    }, 0);
  }
};
```

### Parent-Side Implementation

**Database Schema (Parent):**

```sql
-- Parent application database

CREATE TABLE IF NOT EXISTS process_classifications (
  fingerprint_hash VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  path TEXT,
  file_hash VARCHAR(64),
  signature TEXT,
  publisher VARCHAR(255),
  version VARCHAR(50),

  -- Classification
  classification VARCHAR(50) NOT NULL,
  classification_source VARCHAR(50) NOT NULL,
    -- 'allow2_database', 'ml_model', 'parent_override', 'community'
  confidence DECIMAL(3,2),
  classified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Override
  parent_override VARCHAR(50),  -- Parent can override classification
  override_reason TEXT,
  overridden_at TIMESTAMP,
  overridden_by INT,  -- User ID

  -- Metadata
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  agent_count INT NOT NULL DEFAULT 1,  -- How many agents have seen this

  INDEX idx_classification (classification),
  INDEX idx_name (name),
  INDEX idx_publisher (publisher)
);

CREATE TABLE IF NOT EXISTS process_classification_suggestions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  fingerprint_hash VARCHAR(64) NOT NULL,
  suggested_classification VARCHAR(50) NOT NULL,
  suggested_by VARCHAR(100) NOT NULL,  -- Plugin ID or agent ID
  agent_id VARCHAR(50),
  confidence DECIMAL(3,2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed BOOLEAN NOT NULL DEFAULT FALSE,

  INDEX idx_fingerprint (fingerprint_hash),
  INDEX idx_reviewed (reviewed),
  INDEX idx_suggested_by (suggested_by)
);

CREATE TABLE IF NOT EXISTS agent_process_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  agent_id VARCHAR(50) NOT NULL,
  event_type VARCHAR(20) NOT NULL,  -- 'started', 'stopped'
  process_id VARCHAR(100) NOT NULL,
  fingerprint_hash VARCHAR(64) NOT NULL,
  event_data JSON,
  event_timestamp TIMESTAMP NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_agent_timestamp (agent_id, event_timestamp),
  INDEX idx_fingerprint (fingerprint_hash),
  INDEX idx_event_type (event_type)
);
```

**Parent API Endpoints:**

```typescript
// Parent: src/api/process-classification.controller.ts

@Controller('/api/v1/processes')
class ProcessClassificationController {

  /**
   * POST /api/v1/processes/classify
   * Batch classify processes
   */
  @Post('/classify')
  async classifyProcesses(
    @Body() body: { processes: ClassificationRequest[] },
    @Headers('x-agent-id') agentId: string
  ): Promise<{ classifications: ClassificationResponse[] }> {
    const classifications = await Promise.all(
      body.processes.map(async req => {
        // Check database first
        let classification = await this.classificationService.getClassification(
          req.fingerprintHash
        );

        if (!classification) {
          // Use ML model or Allow2 service
          classification = await this.classificationService.classifyFromService(req);

          // Store in database
          await this.classificationService.storeClassification(
            req.fingerprintHash,
            classification
          );
        }

        return {
          fingerprintHash: req.fingerprintHash,
          classification: classification.classification,
          confidence: classification.confidence,
          source: classification.source
        };
      })
    );

    return { classifications };
  }

  /**
   * POST /api/v1/processes/suggest
   * Plugin suggests classification
   */
  @Post('/suggest')
  async suggestClassification(
    @Body() body: {
      fingerprintHash: string;
      classification: string;
      suggestedBy: string;
    },
    @Headers('x-agent-id') agentId: string
  ): Promise<{ success: boolean }> {
    await this.classificationService.storeSuggestion({
      fingerprintHash: body.fingerprintHash,
      suggestedClassification: body.classification,
      suggestedBy: body.suggestedBy,
      agentId
    });

    // If suggestion has high confidence, auto-apply
    const suggestionCount = await this.classificationService.getSuggestionCount(
      body.fingerprintHash,
      body.classification
    );

    if (suggestionCount >= 3) {
      // Multiple plugins/agents agree - apply classification
      await this.classificationService.applyClassification(
        body.fingerprintHash,
        body.classification,
        'community'
      );
    }

    return { success: true };
  }

  /**
   * GET /api/v1/processes/sync
   * Sync classifications to agent
   */
  @Get('/sync')
  async syncClassifications(
    @Query('since') since: string,
    @Headers('x-agent-id') agentId: string
  ): Promise<{ updates: Array<any> }> {
    const sinceDate = new Date(since);

    const updates = await this.classificationService.getUpdatesSince(
      sinceDate,
      agentId
    );

    return { updates };
  }

  /**
   * POST /api/v1/processes/override
   * Parent overrides classification
   */
  @Post('/override')
  @RequireAuth()
  async overrideClassification(
    @Body() body: {
      fingerprintHash: string;
      classification: string;
      reason?: string;
    },
    @CurrentUser() user: User
  ): Promise<{ success: boolean }> {
    await this.classificationService.applyParentOverride(
      body.fingerprintHash,
      body.classification,
      user.id,
      body.reason
    );

    // Push override to all agents that have seen this process
    await this.agentService.pushClassificationUpdate(
      body.fingerprintHash,
      body.classification
    );

    return { success: true };
  }

  /**
   * POST /api/agent/process-events
   * Agent reports process delta events
   */
  @Post('/events')
  async reportProcessEvents(
    @Body() body: {
      agentId: string;
      events: Array<{
        id: number;
        eventType: string;
        processId: string;
        fingerprintHash: string;
        eventData: any;
        timestamp: string;
      }>;
    }
  ): Promise<{ success: boolean }> {
    // Store events in database
    await this.eventService.storeProcessEvents(body.agentId, body.events);

    // Trigger plugin event handlers
    for (const event of body.events) {
      await this.pluginManager.triggerProcessEvent(
        body.agentId,
        event.eventType,
        event
      );
    }

    return { success: true };
  }
}
```

### Privacy Considerations

**Data Sanitization:**

```typescript
// Ensure no PII is sent to Allow2 API

class ProcessSanitizer {
  sanitizeForApi(fingerprint: ProcessFingerprint): ClassificationRequest {
    return {
      fingerprintHash: fingerprint.processId,
      name: fingerprint.name,
      path: this.sanitizePath(fingerprint.path),
      fileHash: fingerprint.fileHash,
      signature: fingerprint.signature,
      publisher: fingerprint.publisher,
      version: fingerprint.version
    };
  }

  private sanitizePath(path: string | null): string | null {
    if (!path) return null;

    // Remove username from paths
    let sanitized = path.replace(
      /[A-Z]:\\Users\\[^\\]+\\/gi,
      'C:\\Users\\<USER>\\'
    );
    sanitized = sanitized.replace(/\/Users\/[^\/]+\//g, '/Users/<USER>/');
    sanitized = sanitized.replace(/\/home\/[^\/]+\//g, '/home/<USER>/');

    return sanitized;
  }
}
```

### Performance Optimization

**Scan Interval Recommendations:**

```typescript
// Adaptive scanning based on activity

class AdaptiveScanScheduler {
  private baseInterval = 30000; // 30 seconds
  private idleInterval = 120000; // 2 minutes
  private activeInterval = 10000; // 10 seconds

  private lastChangeTime = Date.now();
  private consecutiveNoChanges = 0;

  getNextScanInterval(delta: ProcessDelta): number {
    const hasChanges = delta.started.length > 0 || delta.stopped.length > 0;

    if (hasChanges) {
      // Activity detected - scan more frequently
      this.lastChangeTime = Date.now();
      this.consecutiveNoChanges = 0;
      return this.activeInterval;
    }

    // No changes
    this.consecutiveNoChanges++;

    // After 5 scans with no changes, slow down
    if (this.consecutiveNoChanges > 5) {
      return this.idleInterval;
    }

    return this.baseInterval;
  }
}
```

### Example Use Cases

**Use Case 1: Game Time Tracking**

```typescript
// Plugin tracks when games are running
// Parent enforces time limits
// Agent receives periodic shutdown updates

// Agent: Game starts
processAuditor.on('process:started', (event) => {
  if (event.classification === 'game') {
    // Queue event for parent
    registry.queueEvent('started', event.processId, event.fingerprintHash, {
      gameName: event.name,
      startedAt: Date.now()
    });
  }
});

// Parent: Receives game start event
pluginManager.on('process:started', async (agentId, event) => {
  if (event.classification === 'game') {
    const quota = await quotaService.getDailyQuota(agentId);
    const used = await quotaService.getUsedTime(agentId, 'today');
    const remaining = quota - used;

    if (remaining > 0) {
      // Schedule shutdown
      const shutdownTime = Date.now() + (remaining * 60 * 1000);
      await actionService.scheduleShutdown(agentId, {
        processName: event.name,
        shutdownTime,
        warningIntervals: [10, 5, 2, 1]
      });
    } else {
      // Time's up - immediate shutdown
      await actionService.terminateProcess(agentId, event.name);
    }
  }
});
```

**Use Case 2: Social Media Blocking**

```typescript
// Plugin detects social media apps
// Parent can block specific apps based on schedule

// Agent: Browser starts
processAuditor.on('process:started', (event) => {
  if (event.classification === 'browser') {
    // Notify browser monitor plugin
    pluginManager.notifyPlugin('browser-monitor', 'process:started', event);
  }
});

// Browser Monitor Plugin: Check for social media in browser
plugin.on('process:started', async (event) => {
  if (event.name.includes('chrome') || event.name.includes('firefox')) {
    // Check if social media blocking is active
    const blockingActive = await pluginApi.checkSchedule('social-media-block');

    if (blockingActive) {
      // Inject content blocker
      await pluginApi.executeAction('inject-content-blocker', {
        domains: ['facebook.com', 'instagram.com', 'tiktok.com']
      });
    }
  }
});
```

**Use Case 3: Productivity Tracking**

```typescript
// Track time spent in different app categories
// Generate productivity reports

// Parent: Aggregate process time by classification
class ProductivityTracker {
  async getProductivityReport(agentId: string, date: Date) {
    const events = await eventService.getEventsForDate(agentId, date);

    const timeByCategory = new Map<ProcessClassification, number>();

    for (const event of events) {
      if (event.eventType === 'started') {
        const stopEvent = events.find(
          e => e.eventType === 'stopped' && e.processId === event.processId
        );

        if (stopEvent) {
          const duration = stopEvent.eventTimestamp - event.eventTimestamp;
          const category = event.classification;

          timeByCategory.set(
            category,
            (timeByCategory.get(category) || 0) + duration
          );
        }
      }
    }

    return {
      date,
      totalTime: Array.from(timeByCategory.values()).reduce((a, b) => a + b, 0),
      breakdown: Object.fromEntries(timeByCategory),
      productivityScore: this.calculateProductivityScore(timeByCategory)
    };
  }

  private calculateProductivityScore(
    timeByCategory: Map<ProcessClassification, number>
  ): number {
    const productiveTime =
      (timeByCategory.get(ProcessClassification.PRODUCTIVITY) || 0) +
      (timeByCategory.get(ProcessClassification.DEVELOPMENT) || 0);

    const distractingTime =
      (timeByCategory.get(ProcessClassification.SOCIAL_MEDIA) || 0) +
      (timeByCategory.get(ProcessClassification.GAME) || 0);

    const totalTime = productiveTime + distractingTime;

    if (totalTime === 0) return 0;

    return (productiveTime / totalTime) * 100;
  }
}
```

### Testing Strategy

**Unit Tests:**

```typescript
// tests/core/process-auditor/DeltaCalculator.test.ts

describe('DeltaCalculator', () => {
  let calculator: DeltaCalculator;

  beforeEach(() => {
    calculator = new DeltaCalculator();
  });

  it('should detect started processes', () => {
    const initial: ProcessFingerprint[] = [
      { processId: '1_100', name: 'chrome.exe', ... }
    ];

    const current: ProcessFingerprint[] = [
      { processId: '1_100', name: 'chrome.exe', ... },
      { processId: '2_200', name: 'steam.exe', ... }  // New
    ];

    calculator.calculateDelta(initial); // Initialize
    const delta = calculator.calculateDelta(current);

    expect(delta.started).toHaveLength(1);
    expect(delta.started[0].name).toBe('steam.exe');
  });

  it('should detect stopped processes', () => {
    const initial: ProcessFingerprint[] = [
      { processId: '1_100', name: 'chrome.exe', ... },
      { processId: '2_200', name: 'steam.exe', ... }
    ];

    const current: ProcessFingerprint[] = [
      { processId: '1_100', name: 'chrome.exe', ... }
      // steam.exe stopped
    ];

    calculator.calculateDelta(initial);
    const delta = calculator.calculateDelta(current);

    expect(delta.stopped).toHaveLength(1);
    expect(delta.stopped[0].name).toBe('steam.exe');
  });

  it('should filter out system processes', () => {
    const initial: ProcessFingerprint[] = [];

    const current: ProcessFingerprint[] = [
      { processId: '1_100', name: 'svchost.exe', ... },  // System
      { processId: '2_200', name: 'steam.exe', ... }     // User app
    ];

    calculator.calculateDelta(initial);
    const delta = calculator.calculateDelta(current);

    expect(delta.started).toHaveLength(1);
    expect(delta.started[0].name).toBe('steam.exe');
  });
});
```

### Deployment Checklist

**Agent-Side:**
- [ ] Implement platform-specific process monitors (Windows, macOS, Linux)
- [ ] Implement process fingerprinting engine
- [ ] Create SQLite database schema for process registry
- [ ] Implement delta calculator
- [ ] Implement classification manager with API client
- [ ] Create main ProcessAuditor orchestrator
- [ ] Integrate with heartbeat for delta sync
- [ ] Add plugin query interface

**Parent-Side:**
- [ ] Create process classification database schema
- [ ] Implement classification API endpoints
- [ ] Implement parent override functionality
- [ ] Create classification suggestion review UI
- [ ] Integrate with plugin event system
- [ ] Add Allow2 service classification API
- [ ] Create analytics dashboard for process insights

**Infrastructure:**
- [ ] Setup Allow2 classification service (ML model)
- [ ] Create community classification database
- [ ] Implement privacy-compliant logging
- [ ] Setup monitoring for classification accuracy
- [ ] Create documentation for plugin developers

---

## Future Enhancements

1. **Plugin Marketplace**
   - Community-contributed plugins
   - Plugin rating/reviews
   - One-click install

2. **Advanced Sandboxing**
   - WASM-based isolation
   - Resource limits (CPU, memory, disk)
   - Network access controls

3. **Plugin Debugging Tools**
   - Live monitor output viewer
   - Action testing interface
   - Performance profiling

4. **Cross-Agent Coordination**
   - Plugins can query status of other agents
   - Family-wide quotas (shared across devices)
   - Coordination between sibling agents

5. **Plugin Versioning & Migration**
   - Automatic plugin updates
   - Schema migration for breaking changes
   - Backward compatibility layer
