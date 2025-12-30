/**
 * ProcessMonitor continuously monitors running processes and enforces policies
 */
class ProcessMonitor {
  constructor(policyEngine, platform, logger, checkInterval = 30000) {
    this.policyEngine = policyEngine;
    this.platform = platform;
    this.logger = logger;
    this.checkInterval = checkInterval;
    this.monitorTimer = null;
    this.isRunning = false;
    this.violationHistory = new Map(); // Track violations to prevent spam
  }

  /**
   * Start the monitoring loop
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('ProcessMonitor already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('Starting ProcessMonitor', { interval: this.checkInterval });

    // Run initial check
    await this.checkPolicies();

    // Schedule recurring checks
    this.monitorTimer = setInterval(async () => {
      try {
        await this.checkPolicies();
      } catch (error) {
        this.logger.error('Error in monitoring loop', { error: error.message });
      }
    }, this.checkInterval);
  }

  /**
   * Stop the monitoring loop
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    this.logger.info('Stopped ProcessMonitor');
  }

  /**
   * Check all active policies
   */
  async checkPolicies() {
    const activePolicies = await this.policyEngine.getActivePolicies();

    if (activePolicies.length === 0) {
      this.logger.debug('No active policies to enforce');
      return;
    }

    this.logger.debug(`Checking ${activePolicies.length} active policies`);

    // Check each policy
    const results = await Promise.allSettled(
      activePolicies.map(policy => this.checkPolicy(policy))
    );

    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error('Policy check failed', {
          policy: activePolicies[index].processName,
          error: result.reason
        });
      }
    });
  }

  /**
   * Check a single policy
   */
  async checkPolicy(policy) {
    try {
      // Check if process is running
      const isRunning = await this.platform.isProcessRunning(policy.processName);

      if (!isRunning) {
        // Process not running - clear any violation history
        this.violationHistory.delete(policy.id);
        return;
      }

      // Process is running - check if it's allowed
      if (!policy.allowed) {
        await this.enforcePolicy(policy);
      } else {
        // Process is allowed - check quotas if any
        if (policy.quotas) {
          await this.checkQuotas(policy);
        }
      }
    } catch (error) {
      this.logger.error('Error checking policy', {
        policyId: policy.id,
        processName: policy.processName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Enforce a policy by terminating the process
   */
  async enforcePolicy(policy) {
    try {
      // Get process info before killing
      const processInfo = await this.platform.getProcessInfo(policy.processName);

      // Kill the process
      await this.platform.killProcess(policy.processName);

      this.logger.warn('Terminated prohibited process', {
        policyId: policy.id,
        processName: policy.processName,
        processCount: processInfo.length
      });

      // Report violation (only if we haven't reported recently)
      const lastViolation = this.violationHistory.get(policy.id);
      const now = Date.now();

      if (!lastViolation || (now - lastViolation) > 60000) { // Report max once per minute
        this.violationHistory.set(policy.id, now);
        await this.reportViolation(policy, processInfo);
      }
    } catch (error) {
      this.logger.error('Failed to enforce policy', {
        policyId: policy.id,
        processName: policy.processName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check usage quotas for a process
   */
  async checkQuotas(policy) {
    // TODO: Implement quota checking
    // This would track process runtime and enforce time limits
    // For now, this is a placeholder for future functionality
    if (policy.quotas && policy.quotas.dailyMinutes) {
      this.logger.debug('Quota checking not yet implemented', {
        policyId: policy.id,
        quotas: policy.quotas
      });
    }
  }

  /**
   * Report violation to parent and policy engine
   */
  async reportViolation(policy, processInfo) {
    try {
      await this.policyEngine.reportViolation(policy, processInfo);
    } catch (error) {
      this.logger.error('Failed to report violation', {
        policyId: policy.id,
        error: error.message
      });
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      violationCount: this.violationHistory.size,
      lastCheck: this.lastCheckTime || null
    };
  }

  /**
   * Update check interval
   */
  setCheckInterval(interval) {
    if (interval < 5000) {
      throw new Error('Check interval must be at least 5000ms');
    }

    this.checkInterval = interval;

    // Restart monitoring with new interval if currently running
    if (this.isRunning) {
      this.stop();
      this.start();
    }

    this.logger.info('Updated check interval', { interval });
  }
}

export default ProcessMonitor;
