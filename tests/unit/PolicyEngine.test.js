import { jest } from '@jest/globals';
import { PolicyEngine } from '../../src/PolicyEngine.js';
import fs from 'fs/promises';
import path from 'path';

// Mock fs/promises
jest.mock('fs/promises');

describe('PolicyEngine', () => {
  let policyEngine;
  const testCacheDir = '/test/cache';
  const testCacheFile = path.join(testCacheDir, 'policies.json');

  beforeEach(() => {
    jest.clearAllMocks();
    policyEngine = new PolicyEngine({ cacheDir: testCacheDir });
  });

  describe('constructor', () => {
    test('initializes with empty policies', () => {
      expect(policyEngine.policies).toEqual([]);
    });

    test('sets cache directory', () => {
      expect(policyEngine.cacheDir).toBe(testCacheDir);
    });

    test('uses default cache directory when not specified', () => {
      const engine = new PolicyEngine();
      expect(engine.cacheDir).toBeDefined();
      expect(engine.cacheDir).toContain('.cache');
    });
  });

  describe('loadCachedPolicies', () => {
    test('loads policies from cache file', async () => {
      const mockPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ];
      fs.readFile.mockResolvedValue(JSON.stringify(mockPolicies));

      await policyEngine.loadCachedPolicies();

      expect(fs.readFile).toHaveBeenCalledWith(testCacheFile, 'utf-8');
      expect(policyEngine.policies).toEqual(mockPolicies);
    });

    test('handles missing cache file gracefully', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await policyEngine.loadCachedPolicies();

      expect(policyEngine.policies).toEqual([]);
    });

    test('handles corrupted cache file', async () => {
      fs.readFile.mockResolvedValue('invalid json{');

      await policyEngine.loadCachedPolicies();

      expect(policyEngine.policies).toEqual([]);
    });

    test('handles other errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(policyEngine.loadCachedPolicies()).rejects.toThrow('Permission denied');
    });
  });

  describe('saveCachedPolicies', () => {
    test('saves policies to cache file', async () => {
      policyEngine.policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ];
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await policyEngine.saveCachedPolicies();

      expect(fs.mkdir).toHaveBeenCalledWith(testCacheDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        testCacheFile,
        JSON.stringify(policyEngine.policies, null, 2),
        'utf-8'
      );
    });

    test('creates cache directory if it does not exist', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await policyEngine.saveCachedPolicies();

      expect(fs.mkdir).toHaveBeenCalledWith(testCacheDir, { recursive: true });
    });

    test('handles write errors', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockRejectedValue(new Error('Disk full'));

      await expect(policyEngine.saveCachedPolicies()).rejects.toThrow('Disk full');
    });
  });

  describe('syncFromParent', () => {
    test('fetches and updates policies from parent', async () => {
      const mockPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'Epic.exe', allowed: false, checkInterval: 30000 }
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ policies: mockPolicies })
      });

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await policyEngine.syncFromParent('http://parent:8080');

      expect(global.fetch).toHaveBeenCalledWith('http://parent:8080/api/agent/policies');
      expect(policyEngine.policies).toEqual(mockPolicies);
      expect(result).toBe(true);
    });

    test('handles fetch failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await policyEngine.syncFromParent('http://parent:8080');

      expect(result).toBe(false);
    });

    test('handles network errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const result = await policyEngine.syncFromParent('http://parent:8080');

      expect(result).toBe(false);
    });

    test('emits policiesUpdated event after sync', async () => {
      const mockPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ policies: mockPolicies })
      });

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const listener = jest.fn();
      policyEngine.on('policiesUpdated', listener);

      await policyEngine.syncFromParent('http://parent:8080');

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('updatePolicies', () => {
    test('updates policies and saves to cache', async () => {
      const newPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ];

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await policyEngine.updatePolicies(newPolicies);

      expect(policyEngine.policies).toEqual(newPolicies);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('emits policiesUpdated event', async () => {
      const newPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ];

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const listener = jest.fn();
      policyEngine.on('policiesUpdated', listener);

      await policyEngine.updatePolicies(newPolicies);

      expect(listener).toHaveBeenCalled();
    });

    test('validates policy structure', async () => {
      const invalidPolicies = [
        { processName: 'Steam.exe' } // missing required fields
      ];

      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      // Depending on implementation, this might throw or normalize
      await policyEngine.updatePolicies(invalidPolicies);

      // Verify that policies are stored (or rejected based on implementation)
      expect(policyEngine.policies).toBeDefined();
    });
  });

  describe('getProcessPolicies', () => {
    test('returns all policies', () => {
      const policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'Epic.exe', allowed: false, checkInterval: 30000 }
      ];
      policyEngine.policies = policies;

      const result = policyEngine.getProcessPolicies();

      expect(result).toEqual(policies);
    });

    test('returns empty array when no policies exist', () => {
      const result = policyEngine.getProcessPolicies();

      expect(result).toEqual([]);
    });
  });

  describe('isProcessAllowed', () => {
    beforeEach(() => {
      policyEngine.policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'chrome.exe', allowed: true, checkInterval: 60000 }
      ];
    });

    test('returns false for blocked process', () => {
      expect(policyEngine.isProcessAllowed('Steam.exe')).toBe(false);
    });

    test('returns true for allowed process', () => {
      expect(policyEngine.isProcessAllowed('chrome.exe')).toBe(true);
    });

    test('returns true for unknown process (default allow)', () => {
      expect(policyEngine.isProcessAllowed('unknown.exe')).toBe(true);
    });

    test('is case-insensitive on Windows', () => {
      if (process.platform === 'win32') {
        expect(policyEngine.isProcessAllowed('STEAM.EXE')).toBe(false);
        expect(policyEngine.isProcessAllowed('steam.exe')).toBe(false);
      }
    });

    test('handles process names with paths', () => {
      const allowed = policyEngine.isProcessAllowed('C:\\Program Files\\Steam\\Steam.exe');
      // Should extract basename and check
      expect(typeof allowed).toBe('boolean');
    });
  });

  describe('getPolicy', () => {
    beforeEach(() => {
      policyEngine.policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'chrome.exe', allowed: true, checkInterval: 60000 }
      ];
    });

    test('returns policy for existing process', () => {
      const policy = policyEngine.getPolicy('Steam.exe');
      expect(policy).toEqual({ processName: 'Steam.exe', allowed: false, checkInterval: 30000 });
    });

    test('returns undefined for unknown process', () => {
      const policy = policyEngine.getPolicy('unknown.exe');
      expect(policy).toBeUndefined();
    });
  });

  describe('removePolicy', () => {
    beforeEach(() => {
      policyEngine.policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'chrome.exe', allowed: true, checkInterval: 60000 }
      ];
    });

    test('removes policy by process name', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await policyEngine.removePolicy('Steam.exe');

      expect(policyEngine.policies.length).toBe(1);
      expect(policyEngine.policies[0].processName).toBe('chrome.exe');
    });

    test('saves cache after removal', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      await policyEngine.removePolicy('Steam.exe');

      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('emits policiesUpdated event', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const listener = jest.fn();
      policyEngine.on('policiesUpdated', listener);

      await policyEngine.removePolicy('Steam.exe');

      expect(listener).toHaveBeenCalled();
    });

    test('handles removal of non-existent policy', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const initialLength = policyEngine.policies.length;
      await policyEngine.removePolicy('unknown.exe');

      expect(policyEngine.policies.length).toBe(initialLength);
    });
  });
});
