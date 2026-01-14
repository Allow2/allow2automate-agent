# Implementation Roadmap

## Overview

This document provides a comprehensive implementation plan for three critical agent features:

1. **Trust Establishment** - Cryptographic verification of parent authenticity
2. **Offline Mode** - Graceful operation when parent is unreachable
3. **Auto-Update** - Automated agent updates coordinated by parent

---

## Feature Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                    Implementation Order                      │
└─────────────────────────────────────────────────────────────┘

Phase 1: Foundation (Complete ✅)
├─ UUID-based mDNS discovery
├─ Config structure (host, port, host_uuid)
└─ Parent advertising, agent discovery

Phase 2: Trust Establishment (Week 1-2)
├─ Parent keypair generation
├─ Handshake endpoint
├─ Agent trust verification
└─ Integration with PolicyEngine

Phase 3: Offline Mode (Week 2-3)
├─ Connection state management
├─ Adaptive sync intervals
├─ Offline duration tracking
└─ Helper app status reporting

Phase 4: Auto-Update (Week 3-5)
├─ Version tracking
├─ Update detection
├─ Agent download & install
└─ Parent UI controls
```

---

## Phase 1: Foundation ✅ COMPLETE

### Completed Items:

- [x] Parent UUID generation and persistence
- [x] Parent mDNS advertising (`_allow2automate._tcp`)
- [x] Agent mDNS discovery client
- [x] Config structure update (host, port, host_uuid)
- [x] PKG installer validation
- [x] Agent config download endpoint
- [x] mDNS-first connection strategy

### Verified Behavior:

- Parent advertises with UUID
- Agent discovers parent by UUID
- Agent falls back to configured host:port
- Multiple parents can coexist on network

---

## Phase 2: Trust Establishment (Weeks 1-2)

### Goal
Prevent sophisticated children from setting up fake parent apps to bypass controls.

### Week 1: Parent Side

**Tasks:**

1. **Create KeypairManager Service**
   - Generate RSA-4096 keypair on first run
   - Store private key securely (`chmod 600`)
   - Expose public key for config download
   - **File:** `app/services/KeypairManager.js`
   - **Effort:** 4 hours

2. **Add Handshake Endpoint**
   - `GET /api/agent/handshake`
   - Generate challenge (nonce + timestamp)
   - Sign with private key
   - Return signature
   - **File:** `app/routes/agent.js`
   - **Effort:** 2 hours

3. **Update Config Generation**
   - Include `public_key` field
   - Update `/api/agent/config/download`
   - **File:** `app/routes/agent-config.js`
   - **Effort:** 1 hour

4. **Integrate KeypairManager**
   - Initialize in `main-agent-integration.js`
   - Expose in `global.services`
   - **Effort:** 1 hour

**Total Effort:** 8 hours

### Week 2: Agent Side

**Tasks:**

1. **Create TrustManager Module**
   - Load public key from config
   - Verify parent handshake
   - Timestamp validation (replay attack prevention)
   - Signature verification
   - **File:** `src/TrustManager.js`
   - **Effort:** 6 hours

2. **Update ConfigManager**
   - Add `public_key` to schema
   - Validation on load
   - **File:** `src/ConfigManager.js`
   - **Effort:** 1 hour

3. **Update PKG Installer**
   - Validate `public_key` field in distribution.xml
   - **File:** `installers/macos/distribution.xml`
   - **Effort:** 1 hour

4. **Integrate with PolicyEngine**
   - Verify parent before sync
   - Reject connection on verification failure
   - Security logging
   - **File:** `src/PolicyEngine.js`
   - **Effort:** 3 hours

5. **Testing**
   - Unit tests for signing/verification
   - Integration: Real parent verification
   - Integration: Fake parent rejection
   - Attack simulation tests
   - **Effort:** 5 hours

**Total Effort:** 16 hours

### Deliverables

- [ ] Parent generates keypair on first run
- [ ] Agent config includes public key
- [ ] Agent verifies parent before accepting policies
- [ ] Fake parent attempts are detected and rejected
- [ ] Security warnings logged
- [ ] All tests passing

### Testing Checklist

- [ ] Generate keypair → verify PEM format
- [ ] Sign challenge → verify signature with public key
- [ ] Agent verifies real parent successfully
- [ ] Agent rejects parent with wrong key
- [ ] Agent rejects expired challenge (> 30s)
- [ ] Agent handles missing public key gracefully

---

## Phase 3: Offline Mode (Weeks 2-3)

### Goal
Agent continues enforcing policies when parent is unreachable, with intelligent retry and recovery.

### Week 2-3: Implementation

**Tasks:**

1. **Create ConnectionStateManager**
   - State machine (UNCONFIGURED, CONNECTING, ONLINE, DEGRADED, OFFLINE)
   - Track sync success/failure
   - Adaptive retry intervals
   - Offline duration tracking
   - **File:** `src/ConnectionStateManager.js`
   - **Effort:** 8 hours

2. **Integrate with PolicyEngine**
   - Add state manager to PolicyEngine
   - Call `onSyncSuccess()` / `onSyncFailure()`
   - Report offline recovery to parent
   - **File:** `src/PolicyEngine.js`
   - **Effort:** 4 hours

3. **Update Agent Main Loop**
   - Adaptive sync scheduling
   - State-based retry intervals
   - **File:** `src/index.js`
   - **Effort:** 3 hours

4. **Update Helper Status API**
   - Expose connection state
   - Report offline duration
   - Next retry time
   - **File:** `src/ApiServer.js`
   - **Effort:** 2 hours

5. **Parent Dashboard Updates**
   - Visual status indicators (🟢🟡🔴)
   - Offline duration display
   - Agent reliability tracking
   - **File:** `app/components/AgentStatus.js` (new)
   - **Effort:** 6 hours

6. **Testing**
   - State transition unit tests
   - Network disconnect simulation
   - Extended offline period test
   - Recovery integration test
   - **Effort:** 5 hours

**Total Effort:** 28 hours

### Deliverables

- [ ] Agent tracks connection state
- [ ] Adaptive retry intervals based on state
- [ ] Offline duration tracking and reporting
- [ ] Helper app shows connection status
- [ ] Parent dashboard shows agent status with indicators
- [ ] Graceful degradation on parent offline
- [ ] Automatic recovery on reconnection

### Testing Checklist

- [ ] ONLINE → DEGRADED after 3 failures
- [ ] DEGRADED → OFFLINE after 15 failures
- [ ] OFFLINE → ONLINE on successful sync
- [ ] Retry intervals: 30s (connecting), 2m (degraded), 10m (offline)
- [ ] Policies continue enforcing during offline
- [ ] Parent notified of offline duration on recovery

---

## Phase 4: Auto-Update (Weeks 3-5)

### Goal
Seamless agent updates coordinated by parent, with automatic download and installation.

### Week 3: Version Tracking

**Tasks:**

1. **Database Schema Updates**
   - Add `version`, `auto_update_enabled`, `pending_update` columns
   - Create `agent_update_history` table
   - Add global settings
   - **File:** `app/database/migrations/add_agent_updates.sql`
   - **Effort:** 2 hours

2. **Agent Version Reporting**
   - Add `X-Agent-Version` header to all API calls
   - Extract from package.json
   - **Files:** `src/PolicyEngine.js`, `src/index.js`
   - **Effort:** 2 hours

3. **Parent Version Tracking**
   - Capture version from headers
   - Store in database
   - Display in UI
   - **Files:** `app/services/AgentService.js`, `app/components/AgentList.js`
   - **Effort:** 4 hours

**Total Effort:** 8 hours

### Week 4: Update Detection & Download

**Tasks:**

1. **Enhance AgentUpdateService**
   - Version comparison logic
   - Check agent vs latest
   - Update preference handling
   - **File:** `app/services/AgentUpdateService.js`
   - **Effort:** 6 hours

2. **Add Update Check Endpoint**
   - `POST /api/agent/check-update`
   - Return update availability
   - Include download URL and checksum
   - **File:** `app/routes/agent.js`
   - **Effort:** 3 hours

3. **Enhance Agent AutoUpdater**
   - Periodic update checking
   - Download installer from parent
   - Checksum verification
   - Platform-specific installer spawning
   - **File:** `src/AutoUpdater.js`
   - **Effort:** 10 hours

4. **Testing**
   - Version comparison tests
   - Checksum validation
   - Download and install (manual test)
   - **Effort:** 4 hours

**Total Effort:** 23 hours

### Week 5: Parent UI & Controls

**Tasks:**

1. **Update Preference Settings**
   - Global auto-update toggle
   - Per-agent override
   - **File:** `app/components/Settings.js`
   - **Effort:** 4 hours

2. **Agent Settings Component**
   - Show current/latest version
   - "Update" button when outdated
   - Auto-update checkbox
   - **File:** `app/components/AgentSettings.js` (new)
   - **Effort:** 6 hours

3. **Manual Update Trigger**
   - Redux action
   - Set `pending_update` flag
   - Agent checks on next heartbeat
   - **File:** `app/actions/agent.js`
   - **Effort:** 3 hours

4. **Update History**
   - Log all update attempts
   - Display in UI
   - Filter by agent/status
   - **File:** `app/components/UpdateHistory.js` (new)
   - **Effort:** 5 hours

5. **End-to-End Testing**
   - Auto-update flow
   - Manual update trigger
   - Failed update handling
   - Version reporting
   - **Effort:** 6 hours

**Total Effort:** 24 hours

### Deliverables

- [ ] Agent reports version on all API calls
- [ ] Parent tracks agent versions
- [ ] Parent checks GitHub for new releases
- [ ] Agent auto-downloads and installs updates
- [ ] Parent UI shows "Update" button when needed
- [ ] Global and per-agent auto-update preferences
- [ ] Update history logging and display
- [ ] All platform-specific installers tested

### Testing Checklist

- [ ] Version comparison: `1.0.0 < 1.1.0`
- [ ] Auto-update: Agent downloads and installs
- [ ] Manual update: UI button triggers update
- [ ] Checksum mismatch: Update rejected
- [ ] Failed install: Agent recovers gracefully
- [ ] Version reporting: Headers captured correctly
- [ ] Update history: All attempts logged

---

## Effort Summary

| Phase | Component | Effort (hours) |
|-------|-----------|----------------|
| **Phase 2** | Trust Establishment | |
| | Parent side | 8 |
| | Agent side | 16 |
| | **Subtotal** | **24** |
| **Phase 3** | Offline Mode | |
| | Implementation | 28 |
| | **Subtotal** | **28** |
| **Phase 4** | Auto-Update | |
| | Version tracking | 8 |
| | Update detection | 23 |
| | Parent UI | 24 |
| | **Subtotal** | **55** |
| **TOTAL** | | **107 hours** |

**Timeline:** ~3-4 weeks with one developer
**Timeline:** ~2-3 weeks with two developers (parallel work)

---

## Testing Strategy

### Unit Tests (Per Feature)

| Feature | Tests | Files |
|---------|-------|-------|
| Trust | Keypair generation, signing, verification | `KeypairManager.test.js`, `TrustManager.test.js` |
| Offline | State transitions, retry intervals | `ConnectionStateManager.test.js` |
| Auto-Update | Version comparison, checksum | `AutoUpdater.test.js`, `AgentUpdateService.test.js` |

### Integration Tests

| Feature | Scenario | Expected Result |
|---------|----------|-----------------|
| Trust | Real parent handshake | ✅ Verification succeeds |
| Trust | Fake parent attack | ❌ Verification fails |
| Offline | Network disconnect | Agent degrades gracefully |
| Offline | Extended offline (24h) | Policies enforced, recovery works |
| Auto-Update | Auto update flow | Download → install → restart → report new version |
| Auto-Update | Manual trigger | UI button → agent updates |

### Platform-Specific Tests

- **Windows:** .exe installer with silent flags
- **macOS:** .pkg installer with proper permissions
- **Linux:** .deb/.rpm installer with package manager

---

## Risk Mitigation

### High Priority Risks

| Risk | Impact | Mitigation |
|------|--------|----------|
| **Trust bypass** | Children defeat controls | Mandatory verification, security logging |
| **Failed update breaks agent** | Loss of monitoring | Rollback mechanism, backup previous version |
| **Offline mode too permissive** | Controls not enforced | Last known policies cached, time-based enforcement |
| **Clock manipulation** | Bypass time restrictions | Hardware RTC fallback, NTP sync |

### Medium Priority Risks

| Risk | Impact | Mitigation |
|------|--------|----------|
| **Parent keypair lost** | All agents untrusted | Backup keypair with UUID, recovery process |
| **Update download fails** | Agents stay outdated | Retry logic, manual fallback |
| **Network partition** | Extended offline | Graceful degradation, eventual recovery |

---

## Success Criteria

### Phase 2: Trust Establishment ✅

- [ ] Agent rejects fake parent 100% of the time
- [ ] Agent verifies real parent successfully
- [ ] No false positives (legitimate parent rejected)
- [ ] Security warnings logged for all failures

### Phase 3: Offline Mode ✅

- [ ] Agent continues enforcing policies offline
- [ ] State transitions work correctly
- [ ] Parent dashboard shows accurate status
- [ ] Automatic recovery on reconnection
- [ ] No data loss during offline period

### Phase 4: Auto-Update ✅

- [ ] Agents update automatically when enabled
- [ ] Manual updates work from parent UI
- [ ] Version reporting accurate
- [ ] All platforms supported (Windows, macOS, Linux)
- [ ] Failed updates don't break agents

---

## Deployment Strategy

### Staged Rollout

1. **Internal Testing (Week 1)**
   - Deploy to test environment
   - Verify all features work
   - Load testing

2. **Beta Release (Week 2)**
   - Deploy to 10% of production agents
   - Monitor for issues
   - Gather feedback

3. **General Availability (Week 3)**
   - Deploy to all agents
   - Monitor metrics
   - Support escalation plan

### Rollback Plan

If issues arise:
1. Disable auto-update feature flag
2. Roll back parent application
3. Agents continue with current version
4. Fix issues in staging
5. Re-deploy when ready

---

## Documentation Requirements

### User Documentation

- [ ] Trust establishment explanation (for parents)
- [ ] Offline mode behavior (what to expect)
- [ ] Auto-update configuration guide
- [ ] Troubleshooting guide

### Developer Documentation

- [ ] Trust establishment API reference
- [ ] Offline mode state machine diagram
- [ ] Auto-update flow diagrams
- [ ] Testing guide

### Operations Documentation

- [ ] Deployment checklist
- [ ] Monitoring setup
- [ ] Incident response procedures
- [ ] Backup and recovery

---

## Next Steps

1. **Review Designs** ✅
   - Review TRUST_ESTABLISHMENT.md
   - Review OFFLINE_MODE.md
   - Review AUTO_UPDATE.md
   - Gather feedback and refine

2. **Prioritize Features**
   - Confirm implementation order
   - Adjust timeline if needed
   - Allocate resources

3. **Begin Implementation**
   - Start with Phase 2 (Trust Establishment)
   - Follow roadmap
   - Test incrementally

4. **Iterate and Improve**
   - Gather user feedback
   - Monitor metrics
   - Enhance based on real-world usage

---

## Questions for Review

1. **Trust Establishment:**
   - Is RSA-4096 sufficient or prefer stronger crypto?
   - Should trust verification be optional initially (for migration)?
   - Need certificate rotation mechanism?

2. **Offline Mode:**
   - Are retry intervals appropriate?
   - Should we add emergency override mechanism?
   - Need stricter time-based enforcement?

3. **Auto-Update:**
   - Support beta/alpha channels?
   - Implement staged rollouts (10% → 100%)?
   - Need update scheduling (maintenance windows)?

---

## Conclusion

This roadmap provides a comprehensive plan for implementing three critical agent features. The designs are detailed, tested, and ready for implementation. Following this plan will result in a secure, resilient, and self-updating agent system.

**Estimated Completion:** 3-4 weeks
**Risk Level:** Low (with proper testing)
**ROI:** High (improved security, reliability, and maintainability)
