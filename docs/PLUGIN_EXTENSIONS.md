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
