import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import ProcessMonitor from '../src/ProcessMonitor.js';

describe('ProcessMonitor', () => {
  let processMonitor;
  let mockPolicyEngine;
  let mockPlatform;
  let mockLogger;

  beforeEach(() => {
    mockPolicyEngine = {
      getActivePolicies: jest.fn().mockResolvedValue([]),
      reportViolation: jest.fn().mockResolvedValue(true)
    };

    mockPlatform = {
      isProcessRunning: jest.fn().mockResolvedValue(false),
      killProcess: jest.fn().mockResolvedValue(true),
      getProcessInfo: jest.fn().mockResolvedValue([])
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    processMonitor = new ProcessMonitor(
      mockPolicyEngine,
      mockPlatform,
      mockLogger,
      1000 // Short interval for testing
    );
  });

  afterEach(async () => {
    if (processMonitor.isRunning) {
      await processMonitor.stop();
    }
  });

  describe('initialization', () => {
    it('should initialize with correct properties', () => {
      expect(processMonitor.checkInterval).toBe(1000);
      expect(processMonitor.isRunning).toBe(false);
      expect(processMonitor.monitorTimer).toBeNull();
    });
  });

  describe('start/stop', () => {
    it('should start monitoring', async () => {
      await processMonitor.start();
      expect(processMonitor.isRunning).toBe(true);
      expect(processMonitor.monitorTimer).not.toBeNull();
    });

    it('should not start if already running', async () => {
      await processMonitor.start();
      const firstTimer = processMonitor.monitorTimer;

      await processMonitor.start();
      expect(processMonitor.monitorTimer).toBe(firstTimer);
      expect(mockLogger.warn).toHaveBeenCalledWith('ProcessMonitor already running');
    });

    it('should stop monitoring', async () => {
      await processMonitor.start();
      await processMonitor.stop();

      expect(processMonitor.isRunning).toBe(false);
      expect(processMonitor.monitorTimer).toBeNull();
    });

    it('should handle stop when not running', async () => {
      await processMonitor.stop();
      expect(processMonitor.isRunning).toBe(false);
    });
  });

  describe('checkPolicies', () => {
    it('should check all active policies', async () => {
      const policies = [
        { id: 'p1', processName: 'game.exe', allowed: false },
        { id: 'p2', processName: 'app.exe', allowed: true }
      ];

      mockPolicyEngine.getActivePolicies.mockResolvedValue(policies);
      mockPlatform.isProcessRunning.mockResolvedValue(false);

      await processMonitor.checkPolicies();

      expect(mockPolicyEngine.getActivePolicies).toHaveBeenCalled();
      expect(mockPlatform.isProcessRunning).toHaveBeenCalledTimes(2);
    });

    it('should handle no active policies', async () => {
      mockPolicyEngine.getActivePolicies.mockResolvedValue([]);

      await processMonitor.checkPolicies();

      expect(mockLogger.debug).toHaveBeenCalledWith('No active policies to enforce');
    });

    it('should handle policy check errors', async () => {
      const policies = [
        { id: 'p1', processName: 'game.exe', allowed: false }
      ];

      mockPolicyEngine.getActivePolicies.mockResolvedValue(policies);
      mockPlatform.isProcessRunning.mockRejectedValue(new Error('Platform error'));

      await processMonitor.checkPolicies();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Policy check failed',
        expect.objectContaining({
          policy: 'game.exe'
        })
      );
    });
  });

  describe('checkPolicy', () => {
    it('should clear violation history if process not running', async () => {
      const policy = { id: 'p1', processName: 'game.exe', allowed: false };
      processMonitor.violationHistory.set('p1', Date.now());

      mockPlatform.isProcessRunning.mockResolvedValue(false);

      await processMonitor.checkPolicy(policy);

      expect(processMonitor.violationHistory.has('p1')).toBe(false);
    });

    it('should enforce policy if process running and not allowed', async () => {
      const policy = { id: 'p1', processName: 'game.exe', allowed: false };

      mockPlatform.isProcessRunning.mockResolvedValue(true);
      mockPlatform.getProcessInfo.mockResolvedValue([
        { pid: 1234, name: 'game.exe' }
      ]);

      await processMonitor.checkPolicy(policy);

      expect(mockPlatform.killProcess).toHaveBeenCalledWith('game.exe');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Terminated prohibited process',
        expect.any(Object)
      );
    });

    it('should not kill process if allowed', async () => {
      const policy = { id: 'p1', processName: 'app.exe', allowed: true };

      mockPlatform.isProcessRunning.mockResolvedValue(true);

      await processMonitor.checkPolicy(policy);

      expect(mockPlatform.killProcess).not.toHaveBeenCalled();
    });
  });

  describe('enforcePolicy', () => {
    it('should kill process and report violation', async () => {
      const policy = { id: 'p1', processName: 'game.exe', allowed: false };
      const processInfo = [{ pid: 1234, name: 'game.exe' }];

      mockPlatform.getProcessInfo.mockResolvedValue(processInfo);

      await processMonitor.enforcePolicy(policy);

      expect(mockPlatform.killProcess).toHaveBeenCalledWith('game.exe');
      expect(mockPolicyEngine.reportViolation).toHaveBeenCalledWith(policy, processInfo);
    });

    it('should rate limit violation reports', async () => {
      const policy = { id: 'p1', processName: 'game.exe', allowed: false };

      // First enforcement
      await processMonitor.enforcePolicy(policy);
      expect(mockPolicyEngine.reportViolation).toHaveBeenCalledTimes(1);

      // Second enforcement within 1 minute - should not report
      await processMonitor.enforcePolicy(policy);
      expect(mockPolicyEngine.reportViolation).toHaveBeenCalledTimes(1);
    });

    it('should handle kill errors', async () => {
      const policy = { id: 'p1', processName: 'game.exe', allowed: false };

      mockPlatform.getProcessInfo.mockResolvedValue([]);
      mockPlatform.killProcess.mockRejectedValue(new Error('Kill failed'));

      await expect(processMonitor.enforcePolicy(policy)).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return monitoring status', () => {
      const status = processMonitor.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('checkInterval');
      expect(status).toHaveProperty('violationCount');
      expect(status.checkInterval).toBe(1000);
    });
  });

  describe('setCheckInterval', () => {
    it('should update check interval', () => {
      processMonitor.setCheckInterval(5000);
      expect(processMonitor.checkInterval).toBe(5000);
    });

    it('should throw error if interval too short', () => {
      expect(() => {
        processMonitor.setCheckInterval(1000);
      }).toThrow('Check interval must be at least 5000ms');
    });

    it('should restart monitoring with new interval if running', async () => {
      await processMonitor.start();
      const oldTimer = processMonitor.monitorTimer;

      processMonitor.setCheckInterval(10000);

      expect(processMonitor.checkInterval).toBe(10000);
      expect(processMonitor.isRunning).toBe(true);
      expect(processMonitor.monitorTimer).not.toBe(oldTimer);
    });
  });
});
