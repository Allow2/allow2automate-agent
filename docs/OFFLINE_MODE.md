# Offline Mode Design

## Current Behavior Analysis

### ✅ **Already Implemented:**

The agent currently has basic offline resilience:

1. **Policy Caching** (`PolicyEngine.js:20-26`)
   ```javascript
   loadPoliciesFromCache() {
     const cachedPolicies = this.configManager.get('policies') || [];
     cachedPolicies.forEach(policy => {
       this.policies.set(policy.id, policy);
     });
     this.logger.info(`Loaded ${this.policies.size} policies from cache`);
   }
   ```

2. **Config Persistence** (`ConfigManager.js:53-64`)
   - Configuration saved to platform-specific locations
   - Policies stored in config.json
   - Survives agent restarts

3. **Graceful Sync Failures** (`PolicyEngine.js:syncFromParent`)
   - Returns `false` on sync failure
   - Logs warnings but continues operation
   - Agent continues with cached policies

### ⚠️ **Current Limitations:**

1. **No explicit "offline mode" state**
2. **No grace period tracking**
3. **No offline duration reporting**
4. **No degraded functionality warnings**
5. **No automatic re-sync on reconnection**

---

## Problem Statement

When the agent loses connection to the parent (network outage, parent offline, configuration issues), it should:

1. **Continue enforcing last known policies** (already works)
2. **Track offline duration** (missing)
3. **Attempt periodic reconnection** (missing)
4. **Report offline status to helper app** (missing)
5. **Notify parent of offline period upon reconnection** (missing)

---

## Design Solution: Intelligent Offline Mode

### State Machine

```
┌──────────────────────────────────────────────────────────────────┐
│                        Agent States                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   UNCONFIGURED ──config loaded──> CONNECTING                    │
│                                          │                       │
│                                          ├─success──> ONLINE     │
│                                          │               │       │
│                                          │               │       │
│                                          │        sync fails     │
│                                          │               │       │
│                                          ├─failed──> DEGRADED    │
│                                                          │       │
│                                          retry succeeds──┘       │
│                                          │                       │
│                                   30min timeout                  │
│                                          │                       │
│                                          ▼                       │
│                                      OFFLINE                     │
│                                          │                       │
│                                    retry succeeds                │
│                                          │                       │
│                                          └──────> ONLINE         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### State Definitions

| State | Description | Policy Enforcement | Sync Attempts |
|-------|-------------|-------------------|---------------|
| **UNCONFIGURED** | No valid configuration | None | N/A |
| **CONNECTING** | Initial connection attempt | Cached policies | Every 30s |
| **ONLINE** | Connected to parent | Live policies | Normal interval |
| **DEGRADED** | Recent sync failures | Cached policies | Every 2min |
| **OFFLINE** | Extended disconnection | Cached policies | Every 10min |

---

## Architecture

### 1. Connection State Manager

**File:** `src/ConnectionStateManager.js` (NEW)

```javascript
export const ConnectionState = {
  UNCONFIGURED: 'unconfigured',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

export default class ConnectionStateManager {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.currentState = ConnectionState.UNCONFIGURED;
    this.lastSuccessfulSync = null;
    this.lastSyncAttempt = null;
    this.consecutiveFailures = 0;
    this.offlineSince = null;
    this.stateChangeListeners = [];
  }

  /**
   * Get current state
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check if agent is configured
   */
  isConfigured() {
    return this.configManager.isConfigured();
  }

  /**
   * Record successful sync
   */
  onSyncSuccess() {
    const previousState = this.currentState;
    this.lastSuccessfulSync = Date.now();
    this.lastSyncAttempt = Date.now();
    this.consecutiveFailures = 0;

    // Transition to ONLINE
    if (this.currentState !== ConnectionState.ONLINE) {
      const wasOffline = this.currentState === ConnectionState.OFFLINE;
      const offlineDuration = this.offlineSince ?
        Date.now() - this.offlineSince : 0;

      this.setState(ConnectionState.ONLINE);

      if (wasOffline) {
        this.logger.info('🟢 Reconnected to parent', {
          offlineDuration: Math.round(offlineDuration / 1000),
          previousState
        });
      }

      this.offlineSince = null;
    }
  }

  /**
   * Record sync failure
   */
  onSyncFailure() {
    this.lastSyncAttempt = Date.now();
    this.consecutiveFailures++;

    const timeSinceSuccess = this.lastSuccessfulSync ?
      Date.now() - this.lastSuccessfulSync : Infinity;

    // State transitions based on failure duration
    if (this.consecutiveFailures >= 15) {
      // 15 failures = ~30 minutes (at 2min intervals)
      this.transitionToOffline();
    } else if (this.consecutiveFailures >= 3) {
      // 3+ failures = degraded mode
      this.transitionToDegraded();
    }

    this.logger.warn('Sync failed', {
      consecutiveFailures: this.consecutiveFailures,
      state: this.currentState,
      timeSinceSuccess: Math.round(timeSinceSuccess / 1000)
    });
  }

  /**
   * Transition to DEGRADED state
   */
  transitionToDegraded() {
    if (this.currentState !== ConnectionState.DEGRADED &&
        this.currentState !== ConnectionState.OFFLINE) {
      this.setState(ConnectionState.DEGRADED);
      this.logger.warn('🟡 Entering DEGRADED mode - parent unreachable');
    }
  }

  /**
   * Transition to OFFLINE state
   */
  transitionToOffline() {
    if (this.currentState !== ConnectionState.OFFLINE) {
      if (!this.offlineSince) {
        this.offlineSince = Date.now();
      }
      this.setState(ConnectionState.OFFLINE);
      this.logger.error('🔴 Entering OFFLINE mode - extended parent disconnection');
    }
  }

  /**
   * Set state and notify listeners
   */
  setState(newState) {
    const oldState = this.currentState;
    this.currentState = newState;

    // Persist state to config
    this.configManager.set('connectionState', {
      state: newState,
      lastSuccessfulSync: this.lastSuccessfulSync,
      offlineSince: this.offlineSince,
      updatedAt: Date.now()
    });

    // Notify listeners
    this.stateChangeListeners.forEach(listener => {
      listener(newState, oldState);
    });
  }

  /**
   * Get retry interval based on current state
   */
  getRetryInterval() {
    switch (this.currentState) {
      case ConnectionState.CONNECTING:
        return 30 * 1000; // 30 seconds
      case ConnectionState.DEGRADED:
        return 2 * 60 * 1000; // 2 minutes
      case ConnectionState.OFFLINE:
        return 10 * 60 * 1000; // 10 minutes
      case ConnectionState.ONLINE:
        return this.configManager.get('checkInterval') || 30000;
      default:
        return 60 * 1000; // 1 minute
    }
  }

  /**
   * Get status for reporting
   */
  getStatus() {
    const offlineDuration = this.offlineSince ?
      Date.now() - this.offlineSince : 0;

    const timeSinceSync = this.lastSuccessfulSync ?
      Date.now() - this.lastSuccessfulSync : null;

    return {
      state: this.currentState,
      online: this.currentState === ConnectionState.ONLINE,
      lastSuccessfulSync: this.lastSuccessfulSync,
      timeSinceSync,
      offlineDuration,
      consecutiveFailures: this.consecutiveFailures,
      retryInterval: this.getRetryInterval()
    };
  }

  /**
   * Register state change listener
   */
  onStateChange(callback) {
    this.stateChangeListeners.push(callback);
  }
}
```

### 2. Integration with PolicyEngine

**File:** `src/PolicyEngine.js` (UPDATED)

```javascript
import ConnectionStateManager from './ConnectionStateManager.js';

class PolicyEngine {
  constructor(configManager, logger) {
    // ... existing code ...
    this.connectionState = new ConnectionStateManager(configManager, logger);
  }

  /**
   * Sync policies from parent API with state management
   */
  async syncFromParent() {
    try {
      const parentConnection = await this.getParentConnection();

      if (!parentConnection) {
        this.connectionState.onSyncFailure();
        return false;
      }

      const parentApiUrl = `http://${parentConnection.host}:${parentConnection.port}`;

      // ... trust verification ...
      // ... fetch policies ...

      // ✅ SUCCESS
      this.connectionState.onSyncSuccess();

      // Report offline duration if recovering
      const status = this.connectionState.getStatus();
      if (status.offlineDuration > 0) {
        await this.reportOfflineRecovery(status.offlineDuration);
      }

      return true;

    } catch (error) {
      this.logger.error('Sync failed', { error: error.message });
      this.connectionState.onSyncFailure();
      return false;
    }
  }

  /**
   * Report to parent that agent was offline
   */
  async reportOfflineRecovery(offlineDuration) {
    try {
      const agentId = this.configManager.get('agentId');
      this.logger.info('Reporting offline recovery to parent', {
        offlineDuration: Math.round(offlineDuration / 1000)
      });

      // This will be included in next heartbeat
      // Parent can track agent reliability

    } catch (error) {
      this.logger.error('Failed to report offline recovery', {
        error: error.message
      });
    }
  }

  /**
   * Get connection status for helper app / monitoring
   */
  getConnectionStatus() {
    return this.connectionState.getStatus();
  }
}
```

### 3. Adaptive Sync Scheduling

**File:** `src/index.js` (UPDATED)

```javascript
class Allow2AutomateAgent {
  async start() {
    // ... existing startup code ...

    // Start adaptive sync loop
    this.startAdaptiveSyncLoop();
  }

  /**
   * Adaptive sync loop based on connection state
   */
  startAdaptiveSyncLoop() {
    const syncLoop = async () => {
      try {
        await this.policyEngine.syncFromParent();
      } catch (error) {
        this.logger.error('Sync loop error', { error: error.message });
      }

      // Schedule next sync based on connection state
      const interval = this.policyEngine.connectionState.getRetryInterval();
      this.syncTimer = setTimeout(syncLoop, interval);

      this.logger.debug('Next sync in', {
        seconds: Math.round(interval / 1000),
        state: this.policyEngine.connectionState.getState()
      });
    };

    // Start loop
    syncLoop();
  }

  async shutdown() {
    // Clear sync timer
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    // ... rest of shutdown ...
  }
}
```

### 4. Helper App Integration

**File:** `src/ApiServer.js` (UPDATED)

```javascript
// Helper status endpoint - enhanced with connection state
this.app.get('/api/helper/status', (req, res) => {
  try {
    const connectionStatus = this.policyEngine.getConnectionStatus();

    res.json({
      connected: true,
      connectionState: connectionStatus.state,
      online: connectionStatus.online,
      parentConnected: connectionStatus.online,
      lastSync: connectionStatus.lastSuccessfulSync,
      timeSinceSync: connectionStatus.timeSinceSync,
      offlineDuration: connectionStatus.offlineDuration,
      consecutiveFailures: connectionStatus.consecutiveFailures,
      nextRetry: connectionStatus.retryInterval,
      agentId: this.configManager.get('agentId'),
      hostname: os.hostname(),
      version: this.configManager.get('version') || '1.0.0',
      uptime: Math.floor(process.uptime()),
      configured: this.configManager.isConfigured(),
      monitoringActive: this.processMonitor.isRunning,
      errors: []
    });
  } catch (error) {
    // ... error handling ...
  }
});
```

---

## Policy Enforcement During Offline Mode

### Behavior Matrix

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| **Cached policies exist** | Continue enforcing | Maintain parental controls |
| **No cached policies** | Allow all (with logging) | Can't enforce without rules |
| **Offline > 7 days** | Alert parent on reconnect | Suspicious long outage |
| **Clock manipulation detected** | Use hardware clock / NTP | Prevent bypass |

### Safety Mechanisms

1. **Last Known Good Policies**
   - Always cached to disk
   - Survive reboots
   - Never expire locally

2. **Time-Based Rules**
   - Enforced using system time
   - Clock manipulation detection
   - Fallback to hardware RTC if available

3. **Emergency Override** (Future)
   - Parent can pre-configure emergency contact
   - Agent can be remotely disabled in genuine emergency
   - Requires secure cryptographic proof

---

## Monitoring & Alerting

### Parent Dashboard

Show agent status with visual indicators:

```
┌────────────────────────────────────────────────────────┐
│ Agent: Desktop-123 (Windows 11)                        │
├────────────────────────────────────────────────────────┤
│ Status: 🟢 ONLINE                                      │
│ Last Sync: 2 minutes ago                               │
│ Version: 1.2.0 ✅ Up to date                           │
│ Policies: 15 active                                    │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Agent: Laptop-456 (macOS 13)                           │
├────────────────────────────────────────────────────────┤
│ Status: 🟡 DEGRADED                                    │
│ Last Sync: 15 minutes ago                              │
│ Issue: Network connectivity problems                   │
│ Retrying every 2 minutes...                            │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│ Agent: Tablet-789 (iPad)                               │
├────────────────────────────────────────────────────────┤
│ Status: 🔴 OFFLINE                                     │
│ Last Sync: 2 hours ago                                 │
│ Offline since: 1:45 PM                                 │
│ Using cached policies (15 rules)                       │
│ ⚠️  Device may be disconnected or powered off          │
└────────────────────────────────────────────────────────┘
```

### Parent Notifications

- **Degraded > 15 minutes:** Info notification
- **Offline > 1 hour:** Warning notification
- **Offline > 24 hours:** Alert + email
- **Reconnection after offline:** Info (with duration)

---

## Offline Recovery Process

### When Agent Reconnects:

1. **Verify parent authenticity** (trust establishment)
2. **Report offline metrics:**
   - Offline duration
   - Policy violations during offline period
   - Number of retry attempts
   - Reason for disconnection (if known)
3. **Sync latest policies**
4. **Update agent metadata** (version, platform info)
5. **Resume normal operation**

---

## Configuration

### New Config Fields

```json
{
  "offlineMode": {
    "enabled": true,
    "degradedThreshold": 3,      // failures before DEGRADED
    "offlineThreshold": 15,       // failures before OFFLINE
    "maxOfflineDays": 7,          // alert if offline > 7 days
    "retryIntervals": {
      "connecting": 30000,        // 30s
      "degraded": 120000,         // 2min
      "offline": 600000           // 10min
    }
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **State Transitions**
   - ONLINE → DEGRADED (after 3 failures)
   - DEGRADED → OFFLINE (after 15 failures)
   - OFFLINE → ONLINE (on success)

2. **Retry Intervals**
   - Correct interval for each state
   - Adaptive adjustment

3. **Offline Duration Tracking**
   - Start tracking on offline transition
   - Clear on reconnection

### Integration Tests

1. **Network Disconnection Simulation**
   - Disconnect network mid-sync
   - Verify state transitions
   - Verify policy enforcement continues

2. **Extended Offline Period**
   - Simulate 24-hour offline
   - Verify policies still enforced
   - Verify recovery on reconnection

3. **Parent Offline Scenario**
   - Parent app stops
   - Agent degrades gracefully
   - Agent recovers when parent restarts

---

## Performance Impact

- **State Management:** < 1ms overhead per sync
- **Retry Timer:** No impact (event-driven)
- **Disk I/O:** Minimal (state persisted on change)
- **Memory:** +~100KB for state tracking

---

## Implementation Checklist

**Phase 1: State Management**
- [ ] Create `ConnectionStateManager.js`
- [ ] Add state tracking to `PolicyEngine`
- [ ] Implement adaptive retry intervals
- [ ] Update helper status endpoint

**Phase 2: Monitoring**
- [ ] Add offline duration tracking
- [ ] Report offline recovery to parent
- [ ] Update parent dashboard UI
- [ ] Add parent notifications

**Phase 3: Safety**
- [ ] Clock manipulation detection
- [ ] Emergency override mechanism
- [ ] Long-term offline alerting

**Testing:**
- [ ] Unit tests for state transitions
- [ ] Integration tests for network failures
- [ ] Extended offline scenario testing
- [ ] Parent-agent recovery testing

---

## Future Enhancements

1. **Predictive Offline Detection**
   - Machine learning to predict disconnections
   - Pre-cache additional data before outage

2. **Peer Agent Sync** (Multi-Device Families)
   - Agents share policies via local network
   - Reduces dependency on parent availability

3. **Offline Analytics**
   - Track enforcement accuracy during offline
   - Report policy violation attempts

4. **Graceful Degradation Levels**
   - CRITICAL policies always enforced
   - NON-CRITICAL policies relaxed after extended offline
