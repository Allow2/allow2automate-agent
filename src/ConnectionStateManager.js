/**
 * Connection State Manager
 * Manages agent connection state with intelligent offline mode handling.
 *
 * State Machine:
 * UNCONFIGURED --> CONNECTING --> ONLINE
 *                      |           |
 *                      |      sync fails
 *                      |           |
 *                 failed --> DEGRADED
 *                               |
 *                         30min timeout
 *                               |
 *                            OFFLINE
 *                               |
 *                        retry succeeds
 *                               |
 *                            ONLINE
 */

export const ConnectionState = {
  UNCONFIGURED: 'unconfigured',
  CONNECTING: 'connecting',
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline'
};

export default class ConnectionStateManager {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./Logger.js').default} logger
   */
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.currentState = ConnectionState.UNCONFIGURED;
    this.lastSuccessfulSync = null;
    this.lastSyncAttempt = null;
    this.consecutiveFailures = 0;
    this.offlineSince = null;
    this.stateChangeListeners = [];

    // Hard-coded defaults (reasonable starting values)
    this.settings = {
      degradedThreshold: 3,        // failures before DEGRADED
      offlineThreshold: 15,        // failures before OFFLINE
      maxOfflineDays: 7,           // alert if offline > 7 days
      retryIntervals: {
        connecting: 30000,         // 30s
        degraded: 120000,          // 2min
        offline: 600000            // 10min
      }
    };

    // Load persisted state and settings
    this.loadPersistedState();
  }

  /**
   * Load persisted state from config
   */
  loadPersistedState() {
    const persistedState = this.configManager.get('connectionState');
    if (persistedState) {
      this.lastSuccessfulSync = persistedState.lastSuccessfulSync || null;
      this.offlineSince = persistedState.offlineSince || null;
      // Don't restore the state itself - let the sync loop determine current state
      this.logger.info('Loaded persisted connection state', {
        lastSuccessfulSync: this.lastSuccessfulSync
      });
    }

    // Load settings that were previously synced from parent
    const persistedSettings = this.configManager.get('offlineModeSettings');
    if (persistedSettings) {
      this.settings = { ...this.settings, ...persistedSettings };
      this.logger.info('Loaded offline mode settings from parent', this.settings);
    }
  }

  /**
   * Get current state
   * @returns {string}
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check if agent is configured
   * @returns {boolean}
   */
  isConfigured() {
    const authToken = this.configManager.get('authToken');
    const hostUuid = this.configManager.get('host_uuid');
    const host = this.configManager.get('host');
    return !!(authToken && (hostUuid || host));
  }

  /**
   * Initialize state based on configuration
   */
  initialize() {
    if (this.isConfigured()) {
      this.setState(ConnectionState.CONNECTING);
    } else {
      this.setState(ConnectionState.UNCONFIGURED);
    }
  }

  /**
   * Record successful sync
   */
  onSyncSuccess() {
    const previousState = this.currentState;
    // Calculate offline duration BEFORE clearing offlineSince
    const offlineDuration = this.offlineSince ?
      Date.now() - this.offlineSince : 0;

    this.lastSuccessfulSync = Date.now();
    this.lastSyncAttempt = Date.now();
    this.consecutiveFailures = 0;

    // Transition to ONLINE
    if (this.currentState !== ConnectionState.ONLINE) {
      const wasOffline = this.currentState === ConnectionState.OFFLINE ||
                         this.currentState === ConnectionState.DEGRADED;

      this.setState(ConnectionState.ONLINE);

      if (wasOffline && offlineDuration > 0) {
        this.logger.info('Reconnected to parent', {
          offlineDurationSeconds: Math.round(offlineDuration / 1000),
          previousState
        });
      }

      this.offlineSince = null;
    }

    return {
      offlineDuration,
      previousState
    };
  }

  /**
   * Record sync failure
   */
  onSyncFailure() {
    this.lastSyncAttempt = Date.now();
    this.consecutiveFailures++;

    const timeSinceSuccess = this.lastSuccessfulSync ?
      Date.now() - this.lastSuccessfulSync : Infinity;

    // State transitions based on failure count
    if (this.consecutiveFailures >= this.settings.offlineThreshold) {
      // 15 failures = ~30 minutes (at 2min intervals)
      this.transitionToOffline();
    } else if (this.consecutiveFailures >= this.settings.degradedThreshold) {
      // 3+ failures = degraded mode
      this.transitionToDegraded();
    }

    this.logger.warn('Sync failed', {
      consecutiveFailures: this.consecutiveFailures,
      state: this.currentState,
      timeSinceSuccessSeconds: timeSinceSuccess !== Infinity ?
        Math.round(timeSinceSuccess / 1000) : null
    });
  }

  /**
   * Transition to DEGRADED state
   */
  transitionToDegraded() {
    if (this.currentState !== ConnectionState.DEGRADED &&
        this.currentState !== ConnectionState.OFFLINE) {
      if (!this.offlineSince) {
        this.offlineSince = Date.now();
      }
      this.setState(ConnectionState.DEGRADED);
      this.logger.warn('Entering DEGRADED mode - parent unreachable');
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
      this.logger.error('Entering OFFLINE mode - extended parent disconnection');
    }
  }

  /**
   * Set state and notify listeners
   * @param {string} newState
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
      try {
        listener(newState, oldState);
      } catch (error) {
        this.logger.error('State change listener error', { error: error.message });
      }
    });

    this.logger.debug('Connection state changed', { from: oldState, to: newState });
  }

  /**
   * Get retry interval based on current state
   * @returns {number} milliseconds
   */
  getRetryInterval() {
    switch (this.currentState) {
      case ConnectionState.CONNECTING:
        return this.settings.retryIntervals.connecting;
      case ConnectionState.DEGRADED:
        return this.settings.retryIntervals.degraded;
      case ConnectionState.OFFLINE:
        return this.settings.retryIntervals.offline;
      case ConnectionState.ONLINE:
        return this.configManager.get('checkInterval') || 30000;
      default:
        return 60 * 1000; // 1 minute default
    }
  }

  /**
   * Get status for reporting
   * @returns {Object}
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
      retryInterval: this.getRetryInterval(),
      offlineSince: this.offlineSince,
      settings: this.settings
    };
  }

  /**
   * Check if we've been offline too long (> maxOfflineDays)
   * @returns {boolean}
   */
  isExtendedOffline() {
    if (!this.offlineSince) return false;
    const offlineDays = (Date.now() - this.offlineSince) / (1000 * 60 * 60 * 24);
    return offlineDays > this.settings.maxOfflineDays;
  }

  /**
   * Register state change listener
   * @param {Function} callback
   */
  onStateChange(callback) {
    this.stateChangeListeners.push(callback);
  }

  /**
   * Remove state change listener
   * @param {Function} callback
   */
  offStateChange(callback) {
    const index = this.stateChangeListeners.indexOf(callback);
    if (index > -1) {
      this.stateChangeListeners.splice(index, 1);
    }
  }

  /**
   * Update settings from parent sync
   * @param {Object} newSettings
   */
  updateSettingsFromParent(newSettings) {
    this.settings = { ...this.settings, ...newSettings };

    // Persist settings separately (not in main config)
    this.configManager.set('offlineModeSettings', this.settings);

    this.logger.info('Updated offline mode settings from parent', this.settings);
  }

  /**
   * Clear cached parent connection (for reconnection attempts)
   */
  clearCachedConnection() {
    this.configManager.set('connectionState', {
      ...this.configManager.get('connectionState'),
      cachedParentCleared: Date.now()
    });
  }
}
