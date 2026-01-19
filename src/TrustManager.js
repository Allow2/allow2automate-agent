import crypto from 'crypto';

/**
 * TrustManager - Manages cryptographic verification of parent authenticity
 *
 * Verifies the parent application's identity through RSA signature verification
 * to prevent sophisticated attacks where a child sets up a fake parent app.
 *
 * Security Features:
 * - Public key pinning (parent's public key in agent config)
 * - Challenge-response handshake with cryptographic proof
 * - Timestamp validation to prevent replay attacks
 * - Detailed security logging for audit trails
 */
export default class TrustManager {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.trustedPublicKey = null;
    this.lastVerification = null;
    this.verificationInterval = 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Load trusted public key from config
   * @returns {string} PEM-encoded public key
   */
  loadTrustedKey() {
    const publicKey = this.configManager.get('public_key');
    if (!publicKey) {
      throw new Error('No public key in configuration - cannot verify parent authenticity');
    }

    // Validate PEM format
    if (!publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      throw new Error('Invalid public key format - must be PEM-encoded RSA public key');
    }

    this.trustedPublicKey = publicKey;
    this.logger.info('Loaded trusted public key from configuration');
    return publicKey;
  }

  /**
   * Verify parent handshake
   * @param {string} parentUrl - Parent API base URL (http://host:port)
   * @returns {Promise<boolean>} True if parent is authentic
   */
  async verifyParent(parentUrl) {
    try {
      this.logger.info('Initiating parent authenticity verification', { url: parentUrl });

      // Load trusted public key if not already loaded
      if (!this.trustedPublicKey) {
        this.loadTrustedKey();
      }

      // Request handshake challenge from parent
      const handshakeUrl = `${parentUrl}/api/agent/handshake`;
      this.logger.debug('Requesting handshake challenge', { url: handshakeUrl });

      const response = await fetch(handshakeUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Handshake request failed with status ${response.status}: ${response.statusText}`);
      }

      const { nonce, timestamp, signature, version } = await response.json();

      // Validate response fields
      if (!nonce || !timestamp || !signature) {
        throw new Error('Invalid handshake response - missing required fields (nonce, timestamp, signature)');
      }

      this.logger.debug('Received handshake challenge', {
        nonce: nonce.substring(0, 16) + '...',
        timestamp,
        version
      });

      // Verify timestamp (prevent replay attacks)
      const age = Date.now() - timestamp;
      const maxAge = 30000; // 30 second window

      if (age < 0) {
        throw new Error('Handshake timestamp is in the future - possible clock skew or attack');
      }

      if (age > maxAge) {
        throw new Error(`Handshake timestamp too old (${Math.floor(age / 1000)}s) - potential replay attack (max age: ${maxAge / 1000}s)`);
      }

      this.logger.debug('Timestamp validation passed', { age: `${age}ms` });

      // Verify signature
      const challengeData = `${nonce}:${timestamp}`;
      const verify = crypto.createVerify('SHA256');
      verify.update(challengeData);
      verify.end();

      const isValid = verify.verify(this.trustedPublicKey, signature, 'base64');

      if (!isValid) {
        this.logger.error('❌ SECURITY WARNING: Parent signature verification FAILED', {
          parentUrl,
          nonce: nonce.substring(0, 16) + '...',
          timestamp,
          age: `${age}ms`
        });
        throw new Error('Parent signature verification failed - possible impersonation attempt or key mismatch');
      }

      this.logger.info('✅ Parent authenticity verified successfully', {
        parentUrl,
        age: `${age}ms`,
        version
      });

      this.lastVerification = Date.now();
      return true;

    } catch (error) {
      this.logger.error('Parent verification failed', {
        parentUrl,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Check if parent is currently trusted (based on last verification time)
   * @returns {boolean} True if parent was recently verified
   */
  isTrusted() {
    if (!this.lastVerification) {
      return false;
    }

    const age = Date.now() - this.lastVerification;
    return age < this.verificationInterval;
  }

  /**
   * Get time until re-verification is required
   * @returns {number|null} Milliseconds until re-verification, or null if never verified
   */
  getTimeUntilReverification() {
    if (!this.lastVerification) {
      return null;
    }

    const age = Date.now() - this.lastVerification;
    const remaining = this.verificationInterval - age;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Force re-verification on next parent connection
   */
  invalidateTrust() {
    this.logger.warn('Trust invalidated - will re-verify parent on next connection');
    this.lastVerification = null;
  }

  /**
   * Get verification status
   * @returns {Object} Verification status details
   */
  getStatus() {
    return {
      hasTrustedKey: !!this.trustedPublicKey,
      lastVerification: this.lastVerification,
      isTrusted: this.isTrusted(),
      timeUntilReverification: this.getTimeUntilReverification(),
      verificationInterval: this.verificationInterval
    };
  }
}
