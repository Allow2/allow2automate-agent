# Trust Establishment Design

## Problem Statement

A sophisticated child could potentially set up a fake Allow2Automate parent application to intercept agent connections and defeat parental controls. We need a mechanism to ensure agents only connect to the legitimate parent application that generated their configuration.

**Security Goal:** Agent must verify parent authenticity before accepting policies or commands.

**Non-Goal:** Parent verification of agent is less critical since a fake agent provides no benefit to an attacker.

---

## Design Solution: Public Key Pinning with Challenge-Response

### Overview

The parent application generates an RSA keypair on first run. The agent configuration file includes the parent's public key. When connecting, the agent verifies the parent's identity through a cryptographic challenge-response handshake.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Parent App (First Run)                                      │
├─────────────────────────────────────────────────────────────┤
│ 1. Generate RSA-4096 keypair                                │
│ 2. Store private key in: userData/parent-keypair.pem        │
│ 3. Store public key with UUID in: instance-uuid.json        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent Config Generation (/api/agent/config/download)        │
├─────────────────────────────────────────────────────────────┤
│ {                                                            │
│   "host": "192.168.1.100",                                   │
│   "port": 8080,                                              │
│   "host_uuid": "abc-123-...",                                │
│   "public_key": "-----BEGIN PUBLIC KEY-----\n...",          │
│   "enableMDNS": true,                                        │
│   "checkInterval": 30000,                                    │
│   "logLevel": "info",                                        │
│   "autoUpdate": true                                         │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Agent Connection Flow                                        │
├─────────────────────────────────────────────────────────────┤
│ 1. Discover parent via mDNS (UUID match)                    │
│ 2. Connect to http://parent:port/api/agent/handshake        │
│ 3. Receive challenge: { nonce, timestamp, signature }       │
│ 4. Verify signature using pinned public key                 │
│ 5. If valid: proceed with registration/sync                 │
│ 6. If invalid: REJECT connection, log security warning      │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. Parent Keypair Generation

**File:** `app/services/KeypairManager.js`

```javascript
class KeypairManager {
  constructor(app) {
    this.app = app;
    this.keypairPath = path.join(app.getPath('userData'), 'parent-keypair.pem');
    this.publicKeyPath = path.join(app.getPath('userData'), 'parent-public.pem');
    this.privateKey = null;
    this.publicKey = null;
  }

  /**
   * Get or generate keypair
   */
  async getKeypair() {
    if (this.privateKey && this.publicKey) {
      return { privateKey: this.privateKey, publicKey: this.publicKey };
    }

    // Try to load from disk
    if (fs.existsSync(this.keypairPath)) {
      this.privateKey = fs.readFileSync(this.keypairPath, 'utf8');
      this.publicKey = fs.readFileSync(this.publicKeyPath, 'utf8');
      return { privateKey: this.privateKey, publicKey: this.publicKey };
    }

    // Generate new keypair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Save to disk with secure permissions
    fs.writeFileSync(this.keypairPath, privateKey, { mode: 0o600 });
    fs.writeFileSync(this.publicKeyPath, publicKey, { mode: 0o644 });

    this.privateKey = privateKey;
    this.publicKey = publicKey;

    return { privateKey, publicKey };
  }

  /**
   * Sign a challenge (for agent verification)
   */
  signChallenge(data) {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    sign.end();
    return sign.sign(this.privateKey, 'base64');
  }
}
```

### 2. Updated Config Generation

**File:** `app/routes/agent-config.js`

Add public key to config:

```javascript
router.get('/api/agent/config/download', async (req, res) => {
  const keypairManager = global.services.keypair;
  const { publicKey } = await keypairManager.getKeypair();

  const config = {
    host,
    port,
    host_uuid: parentUuid,
    public_key: publicKey, // ← NEW: Parent's public key
    enableMDNS: true,
    checkInterval: 30000,
    logLevel: 'info',
    autoUpdate: true
  };

  res.json(config);
});
```

### 3. Handshake Endpoint

**File:** `app/routes/agent.js`

```javascript
/**
 * Agent handshake - verify parent authenticity
 * GET /api/agent/handshake
 */
router.get('/api/agent/handshake', async (req, res) => {
  try {
    const keypairManager = global.services.keypair;

    // Generate challenge
    const nonce = crypto.randomBytes(32).toString('base64');
    const timestamp = Date.now();
    const challengeData = `${nonce}:${timestamp}`;

    // Sign challenge with private key
    const signature = keypairManager.signChallenge(challengeData);

    res.json({
      nonce,
      timestamp,
      signature,
      version: '1.0.0'
    });

  } catch (error) {
    res.status(500).json({ error: 'Handshake failed' });
  }
});
```

### 4. Agent Trust Verification

**File:** `src/TrustManager.js` (NEW)

```javascript
import crypto from 'crypto';

export default class TrustManager {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.trustedPublicKey = null;
    this.lastVerification = null;
  }

  /**
   * Load trusted public key from config
   */
  loadTrustedKey() {
    const publicKey = this.configManager.get('public_key');
    if (!publicKey) {
      throw new Error('No public key in configuration - cannot verify parent');
    }
    this.trustedPublicKey = publicKey;
    return publicKey;
  }

  /**
   * Verify parent handshake
   */
  async verifyParent(parentUrl) {
    try {
      this.logger.info('Verifying parent authenticity', { url: parentUrl });

      // Load trusted public key
      if (!this.trustedPublicKey) {
        this.loadTrustedKey();
      }

      // Request handshake challenge
      const response = await fetch(`${parentUrl}/api/agent/handshake`);
      if (!response.ok) {
        throw new Error(`Handshake request failed: ${response.status}`);
      }

      const { nonce, timestamp, signature } = await response.json();

      // Verify timestamp (prevent replay attacks)
      const age = Date.now() - timestamp;
      if (age > 30000) { // 30 second window
        throw new Error('Handshake timestamp too old (potential replay attack)');
      }

      // Verify signature
      const challengeData = `${nonce}:${timestamp}`;
      const verify = crypto.createVerify('SHA256');
      verify.update(challengeData);
      verify.end();

      const isValid = verify.verify(this.trustedPublicKey, signature, 'base64');

      if (!isValid) {
        this.logger.error('❌ SECURITY WARNING: Parent signature verification FAILED');
        throw new Error('Parent signature verification failed - possible impersonation attempt');
      }

      this.logger.info('✅ Parent authenticity verified successfully');
      this.lastVerification = Date.now();

      return true;

    } catch (error) {
      this.logger.error('Parent verification failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if parent is currently trusted
   */
  isTrusted() {
    // Re-verify every 24 hours
    if (!this.lastVerification) return false;
    const age = Date.now() - this.lastVerification;
    return age < (24 * 60 * 60 * 1000);
  }
}
```

### 5. Integration with PolicyEngine

**File:** `src/PolicyEngine.js`

```javascript
import TrustManager from './TrustManager.js';

class PolicyEngine {
  constructor(configManager, logger) {
    // ...existing code...
    this.trustManager = new TrustManager(configManager, logger);
  }

  async syncFromParent() {
    const parentConnection = await this.getParentConnection();
    if (!parentConnection) return false;

    const parentApiUrl = `http://${parentConnection.host}:${parentConnection.port}`;

    // ✅ VERIFY PARENT BEFORE SYNCING
    try {
      await this.trustManager.verifyParent(parentApiUrl);
    } catch (error) {
      this.logger.error('🚨 REFUSING to sync with unverified parent', { error: error.message });
      return false;
    }

    // ... proceed with sync ...
  }
}
```

---

## Security Analysis

### Attack Scenarios & Mitigations

| Attack | Mitigation |
|--------|------------|
| **Child sets up fake parent with different UUID** | Agent won't discover via mDNS (UUID mismatch) |
| **Child sets up fake parent with copied UUID** | Signature verification fails (no private key) |
| **Child intercepts/modifies config file** | Agent fails to connect OR connects to wrong parent, but signature verification fails |
| **Man-in-the-middle attack** | Signature verification detects tampered challenges |
| **Replay attack** | Timestamp validation (30-second window) |
| **Stolen public key** | Useless without private key - cannot sign valid challenges |

### Trust Establishment Flow

```
┌──────────┐                  ┌──────────┐                  ┌──────────┐
│  Parent  │                  │  Agent   │                  │  Fake    │
│  (Real)  │                  │          │                  │  Parent  │
└────┬─────┘                  └────┬─────┘                  └────┬─────┘
     │                             │                             │
     │  1. mDNS: uuid=ABC          │                             │
     ├─────────────────────────────>                             │
     │                             │  2. mDNS: uuid=ABC          │
     │                             <─────────────────────────────┤
     │                             │                             │
     │  3. GET /handshake          │                             │
     <─────────────────────────────┤                             │
     │                             │  4. GET /handshake          │
     │                             ├─────────────────────────────>
     │  5. {nonce, sig=VALID}      │                             │
     ├─────────────────────────────>                             │
     │                             │  6. {nonce, sig=INVALID}    │
     │                             <─────────────────────────────┤
     │                             │                             │
     │  7. ✅ Verify success        │                             │
     │     Connect & sync          │  8. ❌ Verify failed         │
     <─────────────────────────────┤     REJECT connection       │
     │                             │                             │
```

---

## Backward Compatibility

### Migration Strategy

**Phase 1: Optional Trust (v1.1)**
- Add public key to config
- Agent attempts verification but falls back if key missing
- Warning logged: "Operating in insecure mode - no parent verification"

**Phase 2: Mandatory Trust (v1.2)**
- Verification becomes required
- Agents without public key in config refuse to connect
- Force re-download of config from parent

### Config File Versioning

```json
{
  "config_version": "2.0",
  "host": "192.168.1.100",
  "port": 8080,
  "host_uuid": "abc-123",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...",
  "enableMDNS": true,
  ...
}
```

---

## Testing Strategy

### Unit Tests

1. **Keypair Generation**
   - Generate keypair
   - Load existing keypair
   - Verify PEM format

2. **Challenge Signing**
   - Sign challenge data
   - Verify signature with public key
   - Detect invalid signatures

3. **Trust Verification**
   - Valid parent handshake
   - Invalid signature detection
   - Timestamp validation (replay attack)
   - Missing public key handling

### Integration Tests

1. **End-to-End Trust Flow**
   - Generate config with public key
   - Agent verifies real parent
   - Agent rejects fake parent

2. **mDNS + Trust**
   - Discover parent via mDNS
   - Verify parent identity
   - Complete sync

### Security Tests

1. **Attack Simulation**
   - Fake parent with copied UUID
   - Modified challenge responses
   - Replay attack attempt
   - Expired timestamp

---

## Performance Considerations

- **Handshake Cost:** ~50-100ms per verification
- **Verification Frequency:** Once per session + every 24 hours
- **Keypair Generation:** One-time cost on first parent run (~200ms)
- **Storage:** ~8KB per keypair (RSA-4096)

---

## Implementation Checklist

**Parent Side:**
- [ ] Create `KeypairManager.js` service
- [ ] Generate keypair on first run (with UUID)
- [ ] Add `GET /api/agent/handshake` endpoint
- [ ] Include public key in config download
- [ ] Store keypair securely (`chmod 600`)
- [ ] Update `main-agent-integration.js` to initialize KeypairManager

**Agent Side:**
- [ ] Create `TrustManager.js` module
- [ ] Add `public_key` to config schema (ConfigManager)
- [ ] Update `distribution.xml` to validate public_key field
- [ ] Integrate trust verification into PolicyEngine
- [ ] Add security logging for verification failures
- [ ] Implement 24-hour re-verification

**Testing:**
- [ ] Unit tests for signing/verification
- [ ] Integration test: real parent verification
- [ ] Integration test: fake parent rejection
- [ ] Attack simulation tests

---

## Future Enhancements

1. **Certificate Rotation**
   - Support periodic keypair rotation
   - Agent receives new public key via secure channel
   - Grace period for old key acceptance

2. **Multi-Parent Support**
   - Agent can trust multiple parents (home + school)
   - Separate public keys in config

3. **Hardware Security Module (HSM)**
   - Store private key in TPM/Secure Enclave
   - Enhanced protection against key extraction

4. **Certificate Transparency Log**
   - Parent publishes public key to transparency log
   - Agent can verify against known-good keys
