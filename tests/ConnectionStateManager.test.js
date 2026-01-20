import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import ConnectionStateManager, { ConnectionState } from '../src/ConnectionStateManager.js';

describe('ConnectionStateManager', () => {
  let stateManager;
  let mockConfig;
  let mockLogger;

  beforeEach(() => {
    mockConfig = {
      config: {},
      get: jest.fn((key) => mockConfig.config[key]),
      set: jest.fn((key, value) => { mockConfig.config[key] = value; }),
      isConfigured: jest.fn(() => !!(mockConfig.config.authToken && (mockConfig.config.host_uuid || mockConfig.config.host)))
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    stateManager = new ConnectionStateManager(mockConfig, mockLogger);
  });

  describe('initialization', () => {
    it('should start in UNCONFIGURED state', () => {
      expect(stateManager.getState()).toBe(ConnectionState.UNCONFIGURED);
    });

    it('should transition to CONNECTING when initialized with config', () => {
      mockConfig.config = {
        authToken: 'test-token',
        host_uuid: 'test-uuid'
      };
      mockConfig.isConfigured.mockReturnValue(true);
      stateManager.initialize();
      expect(stateManager.getState()).toBe(ConnectionState.CONNECTING);
    });

    it('should stay UNCONFIGURED when initialized without config', () => {
      mockConfig.isConfigured.mockReturnValue(false);
      stateManager.initialize();
      expect(stateManager.getState()).toBe(ConnectionState.UNCONFIGURED);
    });
  });

  describe('onSyncSuccess', () => {
    it('should transition to ONLINE on successful sync', () => {
      mockConfig.config = { authToken: 'test', host_uuid: 'uuid' };
      mockConfig.isConfigured.mockReturnValue(true);
      stateManager.initialize();

      stateManager.onSyncSuccess();

      expect(stateManager.getState()).toBe(ConnectionState.ONLINE);
    });

    it('should reset consecutive failures on success', () => {
      stateManager.consecutiveFailures = 5;

      stateManager.onSyncSuccess();

      expect(stateManager.consecutiveFailures).toBe(0);
    });

    it('should record last successful sync time', () => {
      const beforeSync = Date.now();
      stateManager.onSyncSuccess();
      const afterSync = Date.now();

      expect(stateManager.lastSuccessfulSync).toBeGreaterThanOrEqual(beforeSync);
      expect(stateManager.lastSuccessfulSync).toBeLessThanOrEqual(afterSync);
    });

    it('should return offline duration when recovering from offline', () => {
      // Simulate offline state
      stateManager.currentState = ConnectionState.OFFLINE;
      stateManager.offlineSince = Date.now() - 60000; // 1 minute ago

      const result = stateManager.onSyncSuccess();

      expect(result.offlineDuration).toBeGreaterThan(0);
      expect(result.previousState).toBe(ConnectionState.OFFLINE);
    });

    it('should clear offlineSince after recovery', () => {
      stateManager.currentState = ConnectionState.OFFLINE;
      stateManager.offlineSince = Date.now() - 60000;

      stateManager.onSyncSuccess();

      expect(stateManager.offlineSince).toBeNull();
    });
  });

  describe('onSyncFailure', () => {
    it('should increment consecutive failures', () => {
      stateManager.onSyncFailure();
      expect(stateManager.consecutiveFailures).toBe(1);

      stateManager.onSyncFailure();
      expect(stateManager.consecutiveFailures).toBe(2);
    });

    it('should transition to DEGRADED after threshold failures', () => {
      stateManager.currentState = ConnectionState.ONLINE;

      // Fail 3 times (default degradedThreshold)
      for (let i = 0; i < 3; i++) {
        stateManager.onSyncFailure();
      }

      expect(stateManager.getState()).toBe(ConnectionState.DEGRADED);
    });

    it('should transition to OFFLINE after extended failures', () => {
      stateManager.currentState = ConnectionState.ONLINE;

      // Fail 15 times (default offlineThreshold)
      for (let i = 0; i < 15; i++) {
        stateManager.onSyncFailure();
      }

      expect(stateManager.getState()).toBe(ConnectionState.OFFLINE);
    });

    it('should set offlineSince when entering DEGRADED', () => {
      stateManager.currentState = ConnectionState.ONLINE;

      for (let i = 0; i < 3; i++) {
        stateManager.onSyncFailure();
      }

      expect(stateManager.offlineSince).toBeTruthy();
    });
  });

  describe('getRetryInterval', () => {
    it('should return connecting interval in CONNECTING state', () => {
      stateManager.currentState = ConnectionState.CONNECTING;
      expect(stateManager.getRetryInterval()).toBe(30000); // 30 seconds
    });

    it('should return degraded interval in DEGRADED state', () => {
      stateManager.currentState = ConnectionState.DEGRADED;
      expect(stateManager.getRetryInterval()).toBe(120000); // 2 minutes
    });

    it('should return offline interval in OFFLINE state', () => {
      stateManager.currentState = ConnectionState.OFFLINE;
      expect(stateManager.getRetryInterval()).toBe(600000); // 10 minutes
    });

    it('should return config interval in ONLINE state', () => {
      stateManager.currentState = ConnectionState.ONLINE;
      mockConfig.config.checkInterval = 45000;
      expect(stateManager.getRetryInterval()).toBe(45000);
    });

    it('should return default interval in ONLINE state if not configured', () => {
      stateManager.currentState = ConnectionState.ONLINE;
      expect(stateManager.getRetryInterval()).toBe(30000);
    });
  });

  describe('getStatus', () => {
    it('should return comprehensive status object', () => {
      stateManager.currentState = ConnectionState.ONLINE;
      stateManager.lastSuccessfulSync = Date.now() - 5000;
      stateManager.consecutiveFailures = 0;

      const status = stateManager.getStatus();

      expect(status.state).toBe(ConnectionState.ONLINE);
      expect(status.online).toBe(true);
      expect(status.lastSuccessfulSync).toBeTruthy();
      expect(status.timeSinceSync).toBeGreaterThanOrEqual(5000);
      expect(status.consecutiveFailures).toBe(0);
      expect(status.retryInterval).toBeTruthy();
    });

    it('should report offline=false when not ONLINE', () => {
      stateManager.currentState = ConnectionState.DEGRADED;
      const status = stateManager.getStatus();
      expect(status.online).toBe(false);
    });

    it('should include offline duration when offline', () => {
      stateManager.currentState = ConnectionState.OFFLINE;
      stateManager.offlineSince = Date.now() - 120000;

      const status = stateManager.getStatus();

      expect(status.offlineDuration).toBeGreaterThanOrEqual(120000);
    });
  });

  describe('isExtendedOffline', () => {
    it('should return false when not offline', () => {
      stateManager.offlineSince = null;
      expect(stateManager.isExtendedOffline()).toBe(false);
    });

    it('should return false when offline less than maxOfflineDays', () => {
      stateManager.offlineSince = Date.now() - (1000 * 60 * 60 * 24); // 1 day
      expect(stateManager.isExtendedOffline()).toBe(false);
    });

    it('should return true when offline more than maxOfflineDays', () => {
      stateManager.offlineSince = Date.now() - (1000 * 60 * 60 * 24 * 8); // 8 days
      expect(stateManager.isExtendedOffline()).toBe(true);
    });
  });

  describe('state change listeners', () => {
    it('should notify listeners on state change', () => {
      const listener = jest.fn();
      stateManager.onStateChange(listener);

      stateManager.setState(ConnectionState.ONLINE);

      expect(listener).toHaveBeenCalledWith(ConnectionState.ONLINE, ConnectionState.UNCONFIGURED);
    });

    it('should allow removing listeners', () => {
      const listener = jest.fn();
      stateManager.onStateChange(listener);
      stateManager.offStateChange(listener);

      stateManager.setState(ConnectionState.ONLINE);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('updateSettingsFromParent', () => {
    it('should merge new settings with existing', () => {
      stateManager.updateSettingsFromParent({
        degradedThreshold: 5,
        offlineThreshold: 20
      });

      expect(stateManager.settings.degradedThreshold).toBe(5);
      expect(stateManager.settings.offlineThreshold).toBe(20);
      // Original values should be preserved
      expect(stateManager.settings.maxOfflineDays).toBe(7);
    });

    it('should persist settings to config', () => {
      stateManager.updateSettingsFromParent({ degradedThreshold: 5 });

      expect(mockConfig.set).toHaveBeenCalledWith(
        'offlineModeSettings',
        expect.objectContaining({ degradedThreshold: 5 })
      );
    });
  });

  describe('persistence', () => {
    it('should persist state to config on change', () => {
      stateManager.setState(ConnectionState.ONLINE);

      expect(mockConfig.set).toHaveBeenCalledWith(
        'connectionState',
        expect.objectContaining({ state: ConnectionState.ONLINE })
      );
    });

    it('should load persisted state on construction', () => {
      mockConfig.get.mockImplementation((key) => {
        if (key === 'connectionState') {
          return { lastSuccessfulSync: 1234567890, offlineSince: null };
        }
        return undefined;
      });

      const newManager = new ConnectionStateManager(mockConfig, mockLogger);

      expect(newManager.lastSuccessfulSync).toBe(1234567890);
    });

    it('should load persisted settings on construction', () => {
      mockConfig.get.mockImplementation((key) => {
        if (key === 'offlineModeSettings') {
          return { degradedThreshold: 10 };
        }
        return undefined;
      });

      const newManager = new ConnectionStateManager(mockConfig, mockLogger);

      expect(newManager.settings.degradedThreshold).toBe(10);
    });
  });
});
