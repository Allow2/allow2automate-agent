import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import PolicyEngine from '../src/PolicyEngine.js';

describe('PolicyEngine', () => {
  let policyEngine;
  let mockConfigManager;
  let mockLogger;

  beforeEach(() => {
    mockConfigManager = {
      get: jest.fn(),
      set: jest.fn()
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    // Default config values
    mockConfigManager.get.mockImplementation((key) => {
      const config = {
        policies: [],
        parentApiUrl: null,
        authToken: null,
        agentId: 'test-agent'
      };
      return config[key];
    });

    policyEngine = new PolicyEngine(mockConfigManager, mockLogger);
  });

  describe('initialization', () => {
    it('should load policies from cache', () => {
      const cachedPolicies = [
        { id: 'policy-1', processName: 'game.exe', allowed: false }
      ];

      mockConfigManager.get.mockReturnValue(cachedPolicies);
      const pe = new PolicyEngine(mockConfigManager, mockLogger);

      expect(pe.policies.size).toBe(1);
      expect(pe.policies.get('policy-1').processName).toBe('game.exe');
    });

    it('should handle empty cache', () => {
      expect(policyEngine.policies.size).toBe(0);
    });
  });

  describe('createPolicy', () => {
    it('should create a new policy', async () => {
      const policy = {
        id: 'policy-1',
        processName: 'game.exe',
        allowed: false
      };

      const created = await policyEngine.createPolicy(policy);

      expect(created.id).toBe('policy-1');
      expect(created.processName).toBe('game.exe');
      expect(created.allowed).toBe(false);
      expect(created.createdAt).toBeDefined();
      expect(mockConfigManager.set).toHaveBeenCalled();
    });

    it('should throw error if id or processName missing', async () => {
      await expect(
        policyEngine.createPolicy({ processName: 'test' })
      ).rejects.toThrow('Policy must have id and processName');

      await expect(
        policyEngine.createPolicy({ id: 'test' })
      ).rejects.toThrow('Policy must have id and processName');
    });

    it('should default allowed to true if not specified', async () => {
      const policy = {
        id: 'policy-1',
        processName: 'app.exe'
      };

      const created = await policyEngine.createPolicy(policy);
      expect(created.allowed).toBe(true);
    });
  });

  describe('updatePolicy', () => {
    beforeEach(async () => {
      await policyEngine.createPolicy({
        id: 'policy-1',
        processName: 'game.exe',
        allowed: false
      });
    });

    it('should update existing policy', async () => {
      const updated = await policyEngine.updatePolicy('policy-1', {
        allowed: true
      });

      expect(updated.allowed).toBe(true);
      expect(updated.processName).toBe('game.exe');
      expect(updated.updatedAt).toBeDefined();
    });

    it('should throw error if policy not found', async () => {
      await expect(
        policyEngine.updatePolicy('non-existent', { allowed: true })
      ).rejects.toThrow('Policy not found');
    });

    it('should not allow changing policy ID', async () => {
      const updated = await policyEngine.updatePolicy('policy-1', {
        id: 'new-id',
        processName: 'changed.exe'
      });

      expect(updated.id).toBe('policy-1'); // ID unchanged
      expect(updated.processName).toBe('changed.exe'); // Other fields updated
    });
  });

  describe('deletePolicy', () => {
    beforeEach(async () => {
      await policyEngine.createPolicy({
        id: 'policy-1',
        processName: 'game.exe',
        allowed: false
      });
    });

    it('should delete existing policy', async () => {
      const deleted = await policyEngine.deletePolicy('policy-1');
      expect(deleted).toBe(true);
      expect(policyEngine.policies.has('policy-1')).toBe(false);
    });

    it('should return false if policy does not exist', async () => {
      const deleted = await policyEngine.deletePolicy('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('getPolicy', () => {
    beforeEach(async () => {
      await policyEngine.createPolicy({
        id: 'policy-1',
        processName: 'game.exe',
        allowed: false
      });
    });

    it('should get policy by id', () => {
      const policy = policyEngine.getPolicy('policy-1');
      expect(policy).toBeDefined();
      expect(policy.processName).toBe('game.exe');
    });

    it('should return undefined if not found', () => {
      const policy = policyEngine.getPolicy('non-existent');
      expect(policy).toBeUndefined();
    });
  });

  describe('getAllPolicies', () => {
    it('should return all policies as array', async () => {
      await policyEngine.createPolicy({ id: 'p1', processName: 'app1.exe' });
      await policyEngine.createPolicy({ id: 'p2', processName: 'app2.exe' });

      const policies = policyEngine.getAllPolicies();
      expect(policies).toHaveLength(2);
      expect(Array.isArray(policies)).toBe(true);
    });
  });

  describe('getActivePolicies', () => {
    it('should return policies without schedules', async () => {
      await policyEngine.createPolicy({
        id: 'p1',
        processName: 'app.exe',
        allowed: false
      });

      const active = await policyEngine.getActivePolicies();
      expect(active).toHaveLength(1);
    });

    it('should filter by schedule', async () => {
      // Create policy with schedule outside current time
      await policyEngine.createPolicy({
        id: 'p1',
        processName: 'app.exe',
        allowed: false,
        schedule: {
          startTime: '01:00',
          endTime: '02:00' // Unlikely to be current time
        }
      });

      const active = await policyEngine.getActivePolicies();
      expect(active).toHaveLength(0); // Should be filtered out
    });
  });

  describe('isPolicyActiveNow', () => {
    it('should return true if no schedule', () => {
      const policy = { id: 'p1', processName: 'app.exe' };
      const now = new Date();

      expect(policyEngine.isPolicyActiveNow(policy, now)).toBe(true);
    });

    it('should check day of week', () => {
      const now = new Date('2024-01-15T12:00:00'); // Monday
      const policy = {
        id: 'p1',
        processName: 'app.exe',
        schedule: {
          days: [1] // Monday only
        }
      };

      expect(policyEngine.isPolicyActiveNow(policy, now)).toBe(true);

      policy.schedule.days = [0]; // Sunday only
      expect(policyEngine.isPolicyActiveNow(policy, now)).toBe(false);
    });

    it('should check time range', () => {
      const now = new Date('2024-01-15T14:30:00'); // 2:30 PM

      const policy = {
        id: 'p1',
        processName: 'app.exe',
        schedule: {
          startTime: '14:00',
          endTime: '15:00'
        }
      };

      expect(policyEngine.isPolicyActiveNow(policy, now)).toBe(true);

      policy.schedule.startTime = '15:00';
      policy.schedule.endTime = '16:00';
      expect(policyEngine.isPolicyActiveNow(policy, now)).toBe(false);
    });
  });
});
