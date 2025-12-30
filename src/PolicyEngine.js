import fetch from 'node-fetch';

/**
 * PolicyEngine manages process policies and synchronization with parent
 */
class PolicyEngine {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.policies = new Map();
    this.loadPoliciesFromCache();
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
   * Sync policies from parent API
   */
  async syncFromParent() {
    const parentApiUrl = this.configManager.get('parentApiUrl');
    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    if (!parentApiUrl || !authToken) {
      this.logger.warn('Cannot sync: parent API URL or auth token not configured');
      return false;
    }

    try {
      const response = await fetch(`${parentApiUrl}/api/agents/${agentId}/policies`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const remotePolicies = await response.json();

      // Update local policies
      this.policies.clear();
      remotePolicies.forEach(policy => {
        this.policies.set(policy.id, policy);
      });

      await this.saveToCache();
      this.configManager.set('lastSync', new Date().toISOString());

      this.logger.info(`Synced ${remotePolicies.length} policies from parent`);
      return true;
    } catch (error) {
      this.logger.error('Failed to sync policies from parent', { error: error.message });
      return false;
    }
  }

  /**
   * Report policy violation to parent
   */
  async reportViolation(policy, processInfo) {
    const parentApiUrl = this.configManager.get('parentApiUrl');
    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    if (!parentApiUrl || !authToken) {
      this.logger.warn('Cannot report violation: parent API not configured');
      return false;
    }

    try {
      const violation = {
        agentId,
        policyId: policy.id,
        processName: policy.processName,
        processInfo,
        timestamp: new Date().toISOString(),
        action: 'terminated'
      };

      const response = await fetch(`${parentApiUrl}/api/violations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(violation)
      });

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
