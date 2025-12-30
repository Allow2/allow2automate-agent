import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import ConfigManager from '../src/ConfigManager.js';

describe('ConfigManager', () => {
  let configManager;
  let testConfigPath;

  beforeEach(() => {
    // Use temp directory for tests
    testConfigPath = path.join('/tmp', 'allow2-test-config.json');
    configManager = new ConfigManager(testConfigPath);
  });

  afterEach(() => {
    // Cleanup test config file
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('initialization', () => {
    it('should create default config if file does not exist', () => {
      expect(configManager.config).toBeDefined();
      expect(configManager.config.agentId).toBeNull();
      expect(configManager.config.apiPort).toBe(8443);
    });

    it('should load existing config from file', () => {
      const existingConfig = {
        agentId: 'test-agent-123',
        apiPort: 9000
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(existingConfig));
      const cm = new ConfigManager(testConfigPath);

      expect(cm.config.agentId).toBe('test-agent-123');
      expect(cm.config.apiPort).toBe(9000);
    });
  });

  describe('get/set operations', () => {
    it('should get configuration value', () => {
      expect(configManager.get('apiPort')).toBe(8443);
    });

    it('should set configuration value and save', () => {
      const result = configManager.set('agentId', 'new-agent-id');
      expect(result).toBe(true);
      expect(configManager.get('agentId')).toBe('new-agent-id');

      // Verify it was saved to file
      const saved = JSON.parse(fs.readFileSync(testConfigPath, 'utf8'));
      expect(saved.agentId).toBe('new-agent-id');
    });

    it('should update multiple values', () => {
      const updates = {
        agentId: 'updated-id',
        apiPort: 9999,
        checkInterval: 60000
      };

      const result = configManager.update(updates);
      expect(result).toBe(true);
      expect(configManager.get('agentId')).toBe('updated-id');
      expect(configManager.get('apiPort')).toBe(9999);
      expect(configManager.get('checkInterval')).toBe(60000);
    });
  });

  describe('getAll', () => {
    it('should return all configuration', () => {
      configManager.set('agentId', 'test-id');
      const all = configManager.getAll();

      expect(all.agentId).toBe('test-id');
      expect(all.apiPort).toBeDefined();
      expect(all.checkInterval).toBeDefined();
    });

    it('should return a copy, not reference', () => {
      const all = configManager.getAll();
      all.agentId = 'modified';

      expect(configManager.get('agentId')).not.toBe('modified');
    });
  });

  describe('reset', () => {
    it('should reset to default configuration', () => {
      configManager.set('agentId', 'test-id');
      configManager.set('apiPort', 9999);

      configManager.reset();

      expect(configManager.get('agentId')).toBeNull();
      expect(configManager.get('apiPort')).toBe(8443);
    });
  });

  describe('isConfigured', () => {
    it('should return false if not configured', () => {
      expect(configManager.isConfigured()).toBe(false);
    });

    it('should return true if agentId, parentApiUrl, and authToken are set', () => {
      configManager.update({
        agentId: 'test-id',
        parentApiUrl: 'https://api.example.com',
        authToken: 'test-token'
      });

      expect(configManager.isConfigured()).toBe(true);
    });

    it('should return false if any required field is missing', () => {
      configManager.update({
        agentId: 'test-id',
        parentApiUrl: 'https://api.example.com'
        // authToken missing
      });

      expect(configManager.isConfigured()).toBe(false);
    });
  });

  describe('default config', () => {
    it('should have correct default values', () => {
      const defaults = configManager.getDefaultConfig();

      expect(defaults.agentId).toBeNull();
      expect(defaults.parentApiUrl).toBeNull();
      expect(defaults.authToken).toBeNull();
      expect(defaults.apiPort).toBe(8443);
      expect(defaults.checkInterval).toBe(30000);
      expect(defaults.logLevel).toBe('info');
      expect(defaults.enableMDNS).toBe(true);
      expect(defaults.autoUpdate).toBe(true);
      expect(defaults.policies).toEqual([]);
      expect(defaults.version).toBe('1.0.0');
    });
  });
});
