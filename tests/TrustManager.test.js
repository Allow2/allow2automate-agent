import TrustManager from '../src/TrustManager.js';
import crypto from 'crypto';
import { jest } from '@jest/globals';

// Mock node-fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('TrustManager', () => {
  let trustManager;
  let mockConfigManager;
  let mockLogger;
  let testKeypair;

  beforeEach(() => {
    // Generate test RSA keypair
    testKeypair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Mock ConfigManager
    mockConfigManager = {
      get: jest.fn((key) => {
        if (key === 'public_key') {
          return testKeypair.publicKey;
        }
        return null;
      })
    };

    // Mock Logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    trustManager = new TrustManager(mockConfigManager, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loadTrustedKey()', () => {
    it('should load public key from config', () => {
      const publicKey = trustManager.loadTrustedKey();

      expect(publicKey).toBe(testKeypair.publicKey);
      expect(mockConfigManager.get).toHaveBeenCalledWith('public_key');
    });

    it('should throw error if public key missing from config', () => {
      mockConfigManager.get.mockReturnValue(null);

      expect(() => {
        trustManager.loadTrustedKey();
      }).toThrow('No public key in configuration');
    });

    it('should throw error if public key format invalid', () => {
      mockConfigManager.get.mockReturnValue('invalid-key-format');

      expect(() => {
        trustManager.loadTrustedKey();
      }).toThrow('Invalid public key format');
    });
  });

  describe('verifyParent()', () => {
    const parentUrl = 'http://localhost:8080';

    function createValidHandshake() {
      const nonce = crypto.randomBytes(32).toString('base64');
      const timestamp = Date.now();
      const challengeData = `${nonce}:${timestamp}`;

      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      const signature = sign.sign(testKeypair.privateKey, 'base64');

      return { nonce, timestamp, signature, version: '1.0.0' };
    }

    it('should successfully verify valid parent handshake', async () => {
      const handshake = createValidHandshake();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => handshake
      });

      const result = await trustManager.verifyParent(parentUrl);

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${parentUrl}/api/agent/handshake`,
        expect.any(Object)
      );
      expect(trustManager.lastVerification).toBeTruthy();
    });

    it('should reject handshake with invalid signature', async () => {
      const handshake = createValidHandshake();
      // Tamper with signature
      handshake.signature = 'invalid-signature';

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => handshake
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('signature verification failed');
    });

    it('should reject handshake with expired timestamp (> 30s)', async () => {
      const nonce = crypto.randomBytes(32).toString('base64');
      const timestamp = Date.now() - 60000; // 60 seconds ago
      const challengeData = `${nonce}:${timestamp}`;

      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      const signature = sign.sign(testKeypair.privateKey, 'base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ nonce, timestamp, signature, version: '1.0.0' })
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('timestamp too old');
    });

    it('should reject handshake with future timestamp', async () => {
      const nonce = crypto.randomBytes(32).toString('base64');
      const timestamp = Date.now() + 60000; // 60 seconds in future
      const challengeData = `${nonce}:${timestamp}`;

      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      const signature = sign.sign(testKeypair.privateKey, 'base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ nonce, timestamp, signature, version: '1.0.0' })
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('timestamp is in the future');
    });

    it('should reject handshake signed with different key', async () => {
      // Generate different keypair
      const differentKeypair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      const nonce = crypto.randomBytes(32).toString('base64');
      const timestamp = Date.now();
      const challengeData = `${nonce}:${timestamp}`;

      // Sign with different key
      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      const signature = sign.sign(differentKeypair.privateKey, 'base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ nonce, timestamp, signature, version: '1.0.0' })
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('signature verification failed');
    });

    it('should handle handshake endpoint errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('Handshake request failed');
    });

    it('should handle missing handshake fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ nonce: 'abc' }) // Missing timestamp and signature
      });

      await expect(trustManager.verifyParent(parentUrl)).rejects.toThrow('missing required fields');
    });
  });

  describe('isTrusted()', () => {
    it('should return false if never verified', () => {
      expect(trustManager.isTrusted()).toBe(false);
    });

    it('should return true if recently verified', () => {
      trustManager.lastVerification = Date.now();
      expect(trustManager.isTrusted()).toBe(true);
    });

    it('should return false if verification expired (> 24h)', () => {
      trustManager.lastVerification = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
      expect(trustManager.isTrusted()).toBe(false);
    });
  });

  describe('getTimeUntilReverification()', () => {
    it('should return null if never verified', () => {
      expect(trustManager.getTimeUntilReverification()).toBeNull();
    });

    it('should return time remaining until re-verification needed', () => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      trustManager.lastVerification = oneHourAgo;

      const remaining = trustManager.getTimeUntilReverification();
      const expectedRemaining = 23 * 60 * 60 * 1000; // 23 hours

      // Allow 1 second tolerance for test execution time
      expect(remaining).toBeGreaterThan(expectedRemaining - 1000);
      expect(remaining).toBeLessThan(expectedRemaining + 1000);
    });

    it('should return 0 if re-verification overdue', () => {
      const longAgo = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30 days ago
      trustManager.lastVerification = longAgo;

      expect(trustManager.getTimeUntilReverification()).toBe(0);
    });
  });

  describe('invalidateTrust()', () => {
    it('should clear last verification timestamp', () => {
      trustManager.lastVerification = Date.now();
      expect(trustManager.isTrusted()).toBe(true);

      trustManager.invalidateTrust();

      expect(trustManager.lastVerification).toBeNull();
      expect(trustManager.isTrusted()).toBe(false);
    });
  });

  describe('getStatus()', () => {
    it('should return complete status information', () => {
      trustManager.loadTrustedKey();
      trustManager.lastVerification = Date.now();

      const status = trustManager.getStatus();

      expect(status.hasTrustedKey).toBe(true);
      expect(status.lastVerification).toBeTruthy();
      expect(status.isTrusted).toBe(true);
      expect(status.timeUntilReverification).toBeGreaterThan(0);
      expect(status.verificationInterval).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('Security properties', () => {
    it('should use 30-second timestamp window for replay protection', async () => {
      const handshake = {
        nonce: crypto.randomBytes(32).toString('base64'),
        timestamp: Date.now() - 31000, // 31 seconds ago (just outside window)
        signature: 'test',
        version: '1.0.0'
      };

      // Create valid signature
      const challengeData = `${handshake.nonce}:${handshake.timestamp}`;
      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      handshake.signature = sign.sign(testKeypair.privateKey, 'base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => handshake
      });

      // Should reject due to timestamp being too old
      await expect(trustManager.verifyParent('http://localhost:8080')).rejects.toThrow();
    });

    it('should use SHA256 for signature verification', async () => {
      const nonce = crypto.randomBytes(32).toString('base64');
      const timestamp = Date.now();
      const challengeData = `${nonce}:${timestamp}`;

      // Sign with SHA256
      const sign = crypto.createSign('SHA256');
      sign.update(challengeData);
      sign.end();
      const signature = sign.sign(testKeypair.privateKey, 'base64');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ nonce, timestamp, signature, version: '1.0.0' })
      });

      const result = await trustManager.verifyParent('http://localhost:8080');
      expect(result).toBe(true);
    });
  });
});
