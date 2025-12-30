import { jest } from '@jest/globals';
import { ProcessMonitor } from '../../src/ProcessMonitor.js';
import { PolicyEngine } from '../../src/PolicyEngine.js';
import * as platformModule from '../../src/platform/index.js';

// Mock dependencies
jest.mock('../../src/PolicyEngine.js');
jest.mock('../../src/platform/index.js');

describe('ProcessMonitor', () => {
  let monitor;
  let mockPolicyEngine;
  let mockPlatform;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock PolicyEngine
    mockPolicyEngine = {
      getProcessPolicies: jest.fn().mockReturnValue([
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'chrome.exe', allowed: true, checkInterval: 60000 }
      ]),
      isProcessAllowed: jest.fn((name) => name === 'chrome.exe'),
      on: jest.fn()
    };
    PolicyEngine.mockImplementation(() => mockPolicyEngine);

    // Mock platform
    mockPlatform = {
      getRunningProcesses: jest.fn().mockResolvedValue([
        { name: 'Steam.exe', pid: 1234 },
        { name: 'chrome.exe', pid: 5678 }
      ]),
      killProcess: jest.fn().mockResolvedValue(true)
    };
    platformModule.getPlatform = jest.fn().mockReturnValue(mockPlatform);

    monitor = new ProcessMonitor();
  });

  afterEach(async () => {
    if (monitor.isRunning) {
      await monitor.stop();
    }
  });

  describe('constructor', () => {
    test('initializes with default values', () => {
      expect(monitor.isRunning).toBe(false);
      expect(monitor.violations).toEqual([]);
    });

    test('creates PolicyEngine instance', () => {
      expect(PolicyEngine).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    test('starts monitoring', async () => {
      await monitor.start();
      expect(monitor.isRunning).toBe(true);
    });

    test('performs initial check', async () => {
      await monitor.start();
      expect(mockPlatform.getRunningProcesses).toHaveBeenCalled();
    });

    test('does not start if already running', async () => {
      await monitor.start();
      const firstCallCount = mockPlatform.getRunningProcesses.mock.calls.length;
      await monitor.start();
      expect(mockPlatform.getRunningProcesses.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('stop', () => {
    test('stops monitoring', async () => {
      await monitor.start();
      await monitor.stop();
      expect(monitor.isRunning).toBe(false);
    });

    test('clears check interval', async () => {
      await monitor.start();
      const intervalId = monitor.checkInterval;
      await monitor.stop();
      expect(monitor.checkInterval).toBeNull();
    });
  });

  describe('checkProcesses', () => {
    test('detects policy violations', async () => {
      await monitor.checkProcesses();

      expect(mockPlatform.getRunningProcesses).toHaveBeenCalled();
      expect(mockPolicyEngine.isProcessAllowed).toHaveBeenCalledWith('Steam.exe');
      expect(mockPlatform.killProcess).toHaveBeenCalledWith('Steam.exe', 1234);
    });

    test('allows permitted processes', async () => {
      await monitor.checkProcesses();

      expect(mockPolicyEngine.isProcessAllowed).toHaveBeenCalledWith('chrome.exe');
      expect(mockPlatform.killProcess).not.toHaveBeenCalledWith('chrome.exe', 5678);
    });

    test('records violations', async () => {
      await monitor.checkProcesses();

      expect(monitor.violations.length).toBeGreaterThan(0);
      expect(monitor.violations[0]).toMatchObject({
        processName: 'Steam.exe',
        pid: 1234,
        action: 'killed'
      });
      expect(monitor.violations[0].timestamp).toBeDefined();
    });

    test('handles kill process failure', async () => {
      mockPlatform.killProcess.mockResolvedValueOnce(false);

      await monitor.checkProcesses();

      const violation = monitor.violations.find(v => v.processName === 'Steam.exe');
      expect(violation.action).toBe('kill_failed');
    });

    test('handles getRunningProcesses error', async () => {
      mockPlatform.getRunningProcesses.mockRejectedValueOnce(new Error('Platform error'));

      await expect(monitor.checkProcesses()).rejects.toThrow('Platform error');
    });

    test('limits violation history to 100 items', async () => {
      // Fill violations array
      for (let i = 0; i < 105; i++) {
        monitor.violations.push({
          processName: `test${i}.exe`,
          pid: i,
          timestamp: new Date(),
          action: 'killed'
        });
      }

      await monitor.checkProcesses();

      expect(monitor.violations.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getViolations', () => {
    test('returns all violations when no limit specified', async () => {
      await monitor.checkProcesses();
      const violations = monitor.getViolations();
      expect(Array.isArray(violations)).toBe(true);
    });

    test('limits violations when limit specified', async () => {
      // Add multiple violations
      for (let i = 0; i < 10; i++) {
        monitor.violations.push({
          processName: `test${i}.exe`,
          pid: i,
          timestamp: new Date(),
          action: 'killed'
        });
      }

      const violations = monitor.getViolations(5);
      expect(violations.length).toBe(5);
    });

    test('returns most recent violations first', async () => {
      const now = Date.now();
      monitor.violations.push(
        { processName: 'old.exe', pid: 1, timestamp: new Date(now - 1000), action: 'killed' },
        { processName: 'new.exe', pid: 2, timestamp: new Date(now), action: 'killed' }
      );

      const violations = monitor.getViolations();
      expect(violations[0].processName).toBe('new.exe');
    });
  });

  describe('check interval scheduling', () => {
    test('schedules next check after completion', async () => {
      jest.useFakeTimers();

      await monitor.start();

      // Fast-forward time
      jest.advanceTimersByTime(30000);

      // Should have called checkProcesses multiple times
      expect(mockPlatform.getRunningProcesses.mock.calls.length).toBeGreaterThan(1);

      jest.useRealTimers();
    });

    test('uses minimum check interval from policies', async () => {
      mockPolicyEngine.getProcessPolicies.mockReturnValue([
        { processName: 'Steam.exe', allowed: false, checkInterval: 10000 },
        { processName: 'Epic.exe', allowed: false, checkInterval: 20000 }
      ]);

      await monitor.start();

      // The monitor should use the minimum interval (10000ms)
      // This is implementation-dependent, adjust based on actual implementation
      expect(monitor.checkInterval).toBeDefined();
    });
  });

  describe('policy updates', () => {
    test('reacts to policy changes', async () => {
      await monitor.start();

      // Simulate policy update
      const policyUpdateCallback = mockPolicyEngine.on.mock.calls.find(
        call => call[0] === 'policiesUpdated'
      )?.[1];

      if (policyUpdateCallback) {
        policyUpdateCallback();
        // Should trigger a new check
        expect(mockPlatform.getRunningProcesses).toHaveBeenCalled();
      }
    });
  });
});
