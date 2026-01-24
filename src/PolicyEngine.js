import DiscoveryClient from './DiscoveryClient.js';
import TrustManager from './TrustManager.js';
import ConnectionStateManager from './ConnectionStateManager.js';

/**
 * PolicyEngine manages process policies and synchronization with parent
 */
class PolicyEngine {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./Logger.js').default} logger
   */
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.policies = new Map();
    this.discoveryClient = new DiscoveryClient(logger);
    this.trustManager = new TrustManager(configManager, logger);
    this.connectionState = new ConnectionStateManager(configManager, logger);
    this.cachedParentConnection = null; // Cache discovered parent

    // Plugin extension manager reference (set after construction)
    this.pluginExtensionManager = null;

    this.loadPoliciesFromCache();

    // Initialize connection state
    this.connectionState.initialize();
  }

  /**
   * Set plugin extension manager for sync integration
   * @param {import('./PluginExtensionManager.js').default} pluginExtensionManager
   */
  setPluginExtensionManager(pluginExtensionManager) {
    this.pluginExtensionManager = pluginExtensionManager;
  }

  /**
   * Get current agent version
   * @returns {string}
   */
  getAgentVersion() {
    return this.configManager.get('version') || '1.0.0';
  }

  /**
   * Build common headers for API requests
   * Includes machine identification for first-time registration
   * @returns {Object}
   */
  buildApiHeaders() {
    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    // Get machine ID for first-time registration
    const machineId = this.getMachineId();
    const hostname = require('os').hostname();

    return {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'X-Agent-Version': this.getAgentVersion(),
      'X-Agent-Platform': process.platform,
      'X-Machine-Id': machineId,
      'X-Hostname': hostname,
      'X-Agent-Id': agentId || ''
    };
  }

  /**
   * Get or generate a stable machine ID
   * Uses platform-specific unique identifiers
   * @returns {string}
   */
  getMachineId() {
    // Check if we have a cached machine ID
    let machineId = this.configManager.get('machineId');
    if (machineId) return machineId;

    // Generate machine ID from system info
    const os = require('os');
    const crypto = require('crypto');

    // Create a hash from stable system properties
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.cpus()[0]?.model || 'unknown'
    ];

    // Add network interface MACs for uniqueness
    const networkInterfaces = os.networkInterfaces();
    for (const iface of Object.values(networkInterfaces)) {
      for (const addr of iface) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          components.push(addr.mac);
          break; // Only use first non-internal MAC
        }
      }
    }

    machineId = crypto.createHash('sha256')
      .update(components.join(':'))
      .digest('hex')
      .substring(0, 32);

    // Cache the machine ID
    this.configManager.set('machineId', machineId);
    this.logger.info('Generated machine ID', { machineId });

    return machineId;
  }

  /**
   * Handle JWT upgrade from parent
   * When parent returns a new JWT token, store it for future requests
   * @param {Response} response - Fetch response object
   */
  handleTokenUpgrade(response) {
    const newToken = response.headers.get('X-Agent-Token');
    const newAgentId = response.headers.get('X-Agent-Id');

    if (newToken) {
      this.configManager.set('authToken', newToken);
      this.logger.info('Received and stored new auth token from parent');
    }

    if (newAgentId) {
      this.configManager.set('agentId', newAgentId);
      this.logger.info('Received and stored new agent ID from parent', { agentId: newAgentId });
    }
  }

  /**
   * Load policies from configuration cache
   */
  loadPoliciesFromCache() {
    const cachedPolicies = this.configManager.get('policies') || [];
    cachedPolicies.forEach(policy => {
      this.policies.set(policy.id, policy);
    });
    this.logger.info(`Loaded ${this.policies.size} policies from cache`);
  }

  /**
   * Save policies to configuration cache
   */
  async saveToCache() {
    const policyArray = Array.from(this.policies.values());
    this.configManager.set('policies', policyArray);
    this.logger.debug(`Saved ${policyArray.length} policies to cache`);
  }

  /**
   * Create a new policy
   */
  async createPolicy(policy) {
    // Validate policy structure
    if (!policy.id || !policy.processName) {
      throw new Error('Policy must have id and processName');
    }

    const newPolicy = {
      id: policy.id,
      processName: policy.processName,
      allowed: policy.allowed !== undefined ? policy.allowed : true,
      schedule: policy.schedule || null,
      quotas: policy.quotas || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.policies.set(newPolicy.id, newPolicy);
    await this.saveToCache();

    this.logger.info(`Created policy for ${newPolicy.processName}`, { policyId: newPolicy.id });
    return newPolicy;
  }

  /**
   * Update an existing policy
   */
  async updatePolicy(id, updates) {
    const policy = this.policies.get(id);
    if (!policy) {
      throw new Error(`Policy not found: ${id}`);
    }

    const updatedPolicy = {
      ...policy,
      ...updates,
      id: policy.id, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString()
    };

    this.policies.set(id, updatedPolicy);
    await this.saveToCache();

    this.logger.info(`Updated policy ${id}`);
    return updatedPolicy;
  }

  /**
   * Delete a policy
   */
  async deletePolicy(id) {
    const deleted = this.policies.delete(id);
    if (deleted) {
      await this.saveToCache();
      this.logger.info(`Deleted policy ${id}`);
    }
    return deleted;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(id) {
    return this.policies.get(id);
  }

  /**
   * Get all policies
   */
  getAllPolicies() {
    return Array.from(this.policies.values());
  }

  /**
   * Get active policies (considering schedules)
   */
  async getActivePolicies() {
    const now = new Date();
    const allPolicies = this.getAllPolicies();

    return allPolicies.filter(policy => {
      // If no schedule, policy is always active
      if (!policy.schedule) {
        return true;
      }

      // Check if current time is within schedule
      return this.isPolicyActiveNow(policy, now);
    });
  }

  /**
   * Check if policy is active at given time
   */
  isPolicyActiveNow(policy, now) {
    if (!policy.schedule) return true;

    const { startTime, endTime, days } = policy.schedule;

    // Check day of week
    if (days && days.length > 0) {
      const currentDay = now.getDay(); // 0 = Sunday
      if (!days.includes(currentDay)) {
        return false;
      }
    }

    // Check time range
    if (startTime && endTime) {
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      const start = startHour * 60 + startMin;
      const end = endHour * 60 + endMin;

      if (currentTime < start || currentTime > end) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get parent connection info (via mDNS or fallback to config)
   * Priority: mDNS discovery (if enabled) -> cached connection -> configured host/port
   */
  async getParentConnection() {
    const enableMDNS = this.configManager.get('enableMDNS');
    const hostUuid = this.configManager.get('host_uuid');
    const configHost = this.configManager.get('host');
    const configPort = this.configManager.get('port');

    // If mDNS is enabled (or missing, defaults to true), try discovery first
    if (enableMDNS !== false) {
      if (hostUuid) {
        this.logger.info('mDNS enabled, attempting discovery', { hostUuid });

        // Try cached connection first if available
        if (this.cachedParentConnection) {
          this.logger.debug('Using cached parent connection', this.cachedParentConnection);
          return this.cachedParentConnection;
        }

        // Attempt mDNS discovery
        const discovered = await this.discoveryClient.findParentByUuid(hostUuid);

        if (discovered) {
          this.cachedParentConnection = discovered;
          this.logger.info('Parent discovered via mDNS', discovered);
          return discovered;
        }

        this.logger.warn('mDNS discovery failed, falling back to configured host/port');
      } else {
        this.logger.warn('mDNS enabled but host_uuid not configured');
      }
    }

    // Fallback to configured host/port
    if (configHost && configPort) {
      this.logger.info('Using configured host/port', { host: configHost, port: configPort });
      return { host: configHost, port: configPort };
    }

    this.logger.error('No parent connection available - no mDNS discovery and no configured host/port');
    return null;
  }

  /**
   * Get last sync time
   */
  getLastSyncTime() {
    return this.configManager.get('lastSync');
  }

  /**
   * Sync policies from parent API
   * @returns {Promise<boolean>} success
   */
  async syncFromParent() {
    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    if (!authToken) {
      this.logger.warn('Cannot sync: auth token not configured');
      this.connectionState.onSyncFailure();
      return false;
    }

    // Get parent connection (via mDNS or config)
    const parentConnection = await this.getParentConnection();

    if (!parentConnection) {
      this.logger.warn('Cannot sync: no parent connection available');
      this.connectionState.onSyncFailure();
      return false;
    }

    const parentApiUrl = `http://${parentConnection.host}:${parentConnection.port}`;

    // ✅ VERIFY PARENT AUTHENTICITY BEFORE SYNCING
    // This prevents sophisticated attacks where a child sets up a fake parent app
    try {
      await this.trustManager.verifyParent(parentApiUrl);
    } catch (verificationError) {
      this.logger.error('REFUSING to sync with unverified parent', {
        parentUrl: parentApiUrl,
        error: verificationError.message
      });
      this.connectionState.onSyncFailure();
      return false;
    }

    try {
      // Use common headers with machine info for auto-registration
      const response = await fetch(`${parentApiUrl}/api/agent/policies`, {
        method: 'GET',
        headers: this.buildApiHeaders()
      });

      // Check for token upgrade (first-time registration)
      this.handleTokenUpgrade(response);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Handle response format - could be array or object with policies
      const remotePolicies = Array.isArray(data) ? data : (data.policies || []);

      // Update local policies
      this.policies.clear();
      remotePolicies.forEach(policy => {
        this.policies.set(policy.id, policy);
      });

      await this.saveToCache();
      this.configManager.set('lastSync', new Date().toISOString());

      // Record successful sync
      const recoveryInfo = this.connectionState.onSyncSuccess();

      this.logger.info(`Synced ${remotePolicies.length} policies from parent`);

      // Update offline mode settings if provided
      if (data.offlineSettings) {
        this.connectionState.updateSettingsFromParent(data.offlineSettings);
      }

      // Report offline recovery if we were offline
      if (recoveryInfo.offlineDuration > 0) {
        await this.reportOfflineRecovery(parentApiUrl, recoveryInfo.offlineDuration);
      }

      // Sync plugin data if plugin manager is available
      if (this.pluginExtensionManager) {
        await this.syncPluginData(parentApiUrl);
      }

      return true;
    } catch (error) {
      this.logger.error('Failed to sync policies from parent', { error: error.message });
      this.connectionState.onSyncFailure();

      // Clear cached connection on failure to retry discovery
      if (this.connectionState.getState() === 'degraded') {
        this.cachedParentConnection = null;
      }

      return false;
    }
  }

  /**
   * Report to parent that agent was offline
   * @param {string} parentApiUrl
   * @param {number} offlineDuration - milliseconds
   */
  async reportOfflineRecovery(parentApiUrl, offlineDuration) {
    try {
      const agentId = this.configManager.get('agentId');
      this.logger.info('Reporting offline recovery to parent', {
        offlineDurationSeconds: Math.round(offlineDuration / 1000)
      });

      const response = await fetch(`${parentApiUrl}/api/agent/heartbeat`, {
        method: 'POST',
        headers: this.buildApiHeaders(),
        body: JSON.stringify({
          metadata: {
            offlineRecovery: true,
            offlineDuration,
            recoveredAt: Date.now()
          }
        })
      });
      // Handle token upgrade
      this.handleTokenUpgrade(response);
    } catch (error) {
      // Non-critical - log and continue
      this.logger.warn('Failed to report offline recovery', {
        error: error.message
      });
    }
  }

  /**
   * Get connection status for API/helper
   * @returns {Object}
   */
  getConnectionStatus() {
    return this.connectionState.getStatus();
  }

  /**
   * Sync plugin data to parent
   * @param {string} parentApiUrl - Parent API base URL
   */
  async syncPluginData(parentApiUrl) {
    if (!this.pluginExtensionManager) {
      return;
    }

    const agentId = this.configManager.get('agentId');

    try {
      // Get queued plugin data and action responses
      const pluginData = this.pluginExtensionManager.getQueuedData();
      const actionResponses = this.pluginExtensionManager.getQueuedActionResponses();

      // Skip if nothing to sync
      if (Object.keys(pluginData).length === 0 && actionResponses.length === 0) {
        return;
      }

      // Send plugin data
      const response = await fetch(`${parentApiUrl}/api/agent/plugin-data`, {
        method: 'POST',
        headers: this.buildApiHeaders(),
        body: JSON.stringify({
          agentId,
          pluginData,
          actionResponses,
          timestamp: Date.now()
        })
      });

      // Handle token upgrade
      this.handleTokenUpgrade(response);

      if (response.ok) {
        // Clear synced data
        this.pluginExtensionManager.clearQueuedData();
        this.pluginExtensionManager.clearActionResponses();
        this.logger.info('Plugin data synced to parent');
      } else {
        this.logger.warn('Failed to sync plugin data', {
          status: response.status
        });
      }
    } catch (error) {
      this.logger.error('Plugin data sync error', { error: error.message });
    }
  }

  /**
   * Report policy violation to parent
   */
  async reportViolation(policy, processInfo) {
    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    if (!authToken) {
      this.logger.warn('Cannot report violation: auth token not configured');
      return false;
    }

    // Get parent connection (via mDNS or config)
    const parentConnection = await this.getParentConnection();

    if (!parentConnection) {
      this.logger.warn('Cannot report violation: no parent connection available');
      return false;
    }

    const parentApiUrl = `http://${parentConnection.host}:${parentConnection.port}`;

    try {
      const violation = {
        agentId,
        policyId: policy.id,
        processName: policy.processName,
        processInfo,
        timestamp: new Date().toISOString(),
        action: 'terminated'
      };

      // Use common headers with machine info
      const response = await fetch(`${parentApiUrl}/api/agent/violations`, {
        method: 'POST',
        headers: this.buildApiHeaders(),
        body: JSON.stringify(violation)
      });

      // Handle token upgrade
      this.handleTokenUpgrade(response);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.logger.info('Reported violation to parent', { policyId: policy.id });
      return true;
    } catch (error) {
      this.logger.error('Failed to report violation', { error: error.message });
      return false;
    }
  }
}

export default PolicyEngine;
