/**
 * CommandProcessor handles commands received from the parent app via polling
 *
 * ARCHITECTURE: The agent polls the parent for commands. The parent NEVER
 * connects to the agent. This is a security-first design.
 *
 * Command Types:
 * - POLICY_UPDATE: Update policies
 * - DEPLOY_MONITOR: Deploy a plugin monitor script
 * - DEPLOY_ACTION: Deploy a plugin action script
 * - TRIGGER_ACTION: Execute an action
 * - REMOVE_MONITOR: Remove a deployed monitor
 * - REMOVE_ACTION: Remove a deployed action
 * - UPDATE_CONFIG: Update agent configuration
 * - UPDATE_AVAILABLE: Notify of available update
 */
class CommandProcessor {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./Logger.js').default} logger
   */
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;

    // Will be set after construction
    this.policyEngine = null;
    this.pluginExtensionManager = null;
    this.autoUpdater = null;

    // Track processed command IDs to avoid re-processing
    this.processedCommands = new Set();
    this.maxProcessedHistory = 1000;
  }

  /**
   * Set dependencies
   */
  setPolicyEngine(policyEngine) {
    this.policyEngine = policyEngine;
  }

  setPluginExtensionManager(pluginExtensionManager) {
    this.pluginExtensionManager = pluginExtensionManager;
  }

  setAutoUpdater(autoUpdater) {
    this.autoUpdater = autoUpdater;
  }

  /**
   * Process a batch of commands from parent
   * @param {Array} commands - Commands to process
   * @returns {Promise<Array>} - Results for each command
   */
  async processCommands(commands) {
    const results = [];

    for (const cmd of commands) {
      // Skip if already processed (idempotency)
      if (this.processedCommands.has(cmd.id)) {
        this.logger.debug('Skipping already processed command', { id: cmd.id });
        results.push({ commandId: cmd.id, success: true, skipped: true });
        continue;
      }

      try {
        const result = await this.processCommand(cmd);
        results.push({ commandId: cmd.id, success: true, result });

        // Track as processed
        this.trackProcessed(cmd.id);

      } catch (error) {
        this.logger.error('Command processing failed', {
          commandId: cmd.id,
          type: cmd.type,
          error: error.message
        });
        results.push({ commandId: cmd.id, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Process a single command
   * @param {Object} cmd - Command to process
   * @returns {Promise<Object>} - Result
   */
  async processCommand(cmd) {
    this.logger.info('Processing command', { id: cmd.id, type: cmd.type });

    switch (cmd.type) {
      case 'POLICY_UPDATE':
        return this.handlePolicyUpdate(cmd);

      case 'DEPLOY_MONITOR':
        return this.handleDeployMonitor(cmd);

      case 'DEPLOY_ACTION':
        return this.handleDeployAction(cmd);

      case 'TRIGGER_ACTION':
        return this.handleTriggerAction(cmd);

      case 'REMOVE_MONITOR':
        return this.handleRemoveMonitor(cmd);

      case 'REMOVE_ACTION':
        return this.handleRemoveAction(cmd);

      case 'UPDATE_CONFIG':
        return this.handleUpdateConfig(cmd);

      case 'UPDATE_AVAILABLE':
        return this.handleUpdateAvailable(cmd);

      default:
        this.logger.warn('Unknown command type', { type: cmd.type });
        return { handled: false, reason: 'Unknown command type' };
    }
  }

  /**
   * Handle policy update command
   */
  async handlePolicyUpdate(cmd) {
    if (!this.policyEngine) {
      throw new Error('PolicyEngine not available');
    }

    const { policies } = cmd;

    if (!policies || !Array.isArray(policies)) {
      throw new Error('Invalid policies in command');
    }

    // Clear and reload policies
    this.policyEngine.policies.clear();
    policies.forEach(policy => {
      this.policyEngine.policies.set(policy.id, policy);
    });

    await this.policyEngine.saveToCache();

    this.logger.info(`Processed policy update: ${policies.length} policies`);
    return { policyCount: policies.length };
  }

  /**
   * Handle deploy monitor command
   */
  async handleDeployMonitor(cmd) {
    if (!this.pluginExtensionManager) {
      throw new Error('PluginExtensionManager not available');
    }

    const { pluginId, monitorId, script, interval, platforms, checksum } = cmd;

    if (!pluginId || !monitorId || !script) {
      throw new Error('Missing required fields: pluginId, monitorId, script');
    }

    const result = this.pluginExtensionManager.deployMonitor({
      pluginId,
      monitorId,
      script,
      interval: interval || 30000,
      platforms,
      checksum
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to deploy monitor');
    }

    this.logger.info('Deployed monitor', { pluginId, monitorId });
    return result;
  }

  /**
   * Handle deploy action command
   */
  async handleDeployAction(cmd) {
    if (!this.pluginExtensionManager) {
      throw new Error('PluginExtensionManager not available');
    }

    const { pluginId, actionId, script, platforms, checksum } = cmd;

    if (!pluginId || !actionId || !script) {
      throw new Error('Missing required fields: pluginId, actionId, script');
    }

    const result = this.pluginExtensionManager.deployAction({
      pluginId,
      actionId,
      script,
      platforms,
      checksum
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to deploy action');
    }

    this.logger.info('Deployed action', { pluginId, actionId });
    return result;
  }

  /**
   * Handle trigger action command
   */
  async handleTriggerAction(cmd) {
    if (!this.pluginExtensionManager) {
      throw new Error('PluginExtensionManager not available');
    }

    const { pluginId, actionId, triggerId, arguments: args } = cmd;

    if (!pluginId || !actionId || !triggerId) {
      throw new Error('Missing required fields: pluginId, actionId, triggerId');
    }

    const result = await this.pluginExtensionManager.triggerAction({
      pluginId,
      actionId,
      triggerId,
      arguments: args || {}
    });

    this.logger.info('Triggered action', { pluginId, actionId, triggerId });
    return result;
  }

  /**
   * Handle remove monitor command
   */
  async handleRemoveMonitor(cmd) {
    if (!this.pluginExtensionManager) {
      throw new Error('PluginExtensionManager not available');
    }

    const { pluginId, monitorId } = cmd;

    if (!pluginId || !monitorId) {
      throw new Error('Missing required fields: pluginId, monitorId');
    }

    const removed = this.pluginExtensionManager.removeMonitor(pluginId, monitorId);

    this.logger.info('Removed monitor', { pluginId, monitorId, success: removed });
    return { removed };
  }

  /**
   * Handle remove action command
   */
  async handleRemoveAction(cmd) {
    if (!this.pluginExtensionManager) {
      throw new Error('PluginExtensionManager not available');
    }

    const { pluginId, actionId } = cmd;

    if (!pluginId || !actionId) {
      throw new Error('Missing required fields: pluginId, actionId');
    }

    const removed = this.pluginExtensionManager.removeAction(pluginId, actionId);

    this.logger.info('Removed action', { pluginId, actionId, success: removed });
    return { removed };
  }

  /**
   * Handle config update command
   */
  async handleUpdateConfig(cmd) {
    const { config } = cmd;

    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config in command');
    }

    // Don't allow updating sensitive fields via command
    const allowedFields = ['checkInterval', 'logLevel', 'enableMDNS', 'autoUpdate'];
    const filteredConfig = {};

    for (const key of allowedFields) {
      if (config[key] !== undefined) {
        filteredConfig[key] = config[key];
      }
    }

    this.configManager.update(filteredConfig);

    this.logger.info('Updated config via command', { fields: Object.keys(filteredConfig) });
    return { updated: Object.keys(filteredConfig) };
  }

  /**
   * Handle update available notification
   */
  async handleUpdateAvailable(cmd) {
    if (!this.autoUpdater) {
      throw new Error('AutoUpdater not available');
    }

    const { version, downloadUrl, checksum, autoApply } = cmd;

    if (!version || !downloadUrl) {
      throw new Error('Missing required fields: version, downloadUrl');
    }

    const updateInfo = {
      latestVersion: version,
      downloadUrl,
      checksum,
      updateAvailable: true,
      autoUpdate: autoApply !== false
    };

    if (autoApply !== false) {
      // Auto-apply the update
      const result = await this.autoUpdater.triggerUpdate(updateInfo);
      this.logger.info('Auto-update triggered', { version, success: result.success });
      return result;
    } else {
      // Just notify, don't auto-apply
      this.logger.info('Update available notification received', { version });
      return { notified: true, version };
    }
  }

  /**
   * Track a processed command ID
   */
  trackProcessed(commandId) {
    this.processedCommands.add(commandId);

    // Prune old entries if too many
    if (this.processedCommands.size > this.maxProcessedHistory) {
      const entries = Array.from(this.processedCommands);
      const toRemove = entries.slice(0, entries.length - this.maxProcessedHistory / 2);
      toRemove.forEach(id => this.processedCommands.delete(id));
    }
  }

  /**
   * Clear processed command history
   */
  clearProcessedHistory() {
    this.processedCommands.clear();
  }
}

export default CommandProcessor;
