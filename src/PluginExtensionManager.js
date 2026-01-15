import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PluginExtensionManager manages plugin data monitors and action scripts
 * deployed from the parent application.
 *
 * Key responsibilities:
 * - Deploy and manage monitor scripts (executed at intervals)
 * - Deploy and manage action scripts (triggered by parent)
 * - Queue collected data for sync to parent
 * - Execute actions with arguments and queue responses
 * - Handle offline data caching and batch sync
 * - Implement debounce for action responses
 */
class PluginExtensionManager {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./Logger.js').default} logger
   */
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;

    // Plugin storage paths
    this.pluginDir = this.getPluginDirectory();
    this.dataQueueDir = path.join(this.pluginDir, 'data-queue');
    this.actionQueueDir = path.join(this.pluginDir, 'action-responses');

    // In-memory registries
    this.monitors = new Map(); // pluginId:monitorId -> MonitorConfig
    this.actions = new Map();  // pluginId:actionId -> ActionConfig
    this.monitorTimers = new Map(); // pluginId:monitorId -> intervalId

    // Data queues
    this.dataQueue = new Map(); // pluginId:monitorId -> Array<DataEntry>
    this.actionResponseQueue = []; // Array<ActionResponse>

    // Debounce settings
    this.responseDebounceMs = 2000; // 2 seconds
    this.responseDebounceTimer = null;

    // Sandbox timeout
    this.scriptTimeout = 5000; // 5 seconds
    this.scriptMemoryLimit = '128MB';

    // Initialize directories
    this.ensureDirectories();

    // Load cached monitors and actions
    this.loadFromCache();
  }

  /**
   * Get platform-specific plugin directory
   * @returns {string}
   */
  getPluginDirectory() {
    const platform = process.platform;
    let pluginDir;

    switch (platform) {
      case 'win32':
        pluginDir = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Allow2', 'agent', 'plugins');
        break;
      case 'darwin':
        pluginDir = '/Library/Application Support/Allow2/agent/plugins';
        break;
      default: // linux
        pluginDir = '/var/lib/allow2/agent/plugins';
    }

    return pluginDir;
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    const dirs = [this.pluginDir, this.dataQueueDir, this.actionQueueDir];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
        this.logger.debug(`Created plugin directory: ${dir}`);
      }
    }
  }

  /**
   * Load cached monitors and actions from disk
   */
  loadFromCache() {
    try {
      // Load monitors
      const monitorsFile = path.join(this.pluginDir, 'monitors.json');
      if (fs.existsSync(monitorsFile)) {
        const monitorsData = JSON.parse(fs.readFileSync(monitorsFile, 'utf8'));
        for (const monitor of monitorsData) {
          const key = `${monitor.pluginId}:${monitor.monitorId}`;
          this.monitors.set(key, monitor);
        }
        this.logger.info(`Loaded ${this.monitors.size} monitors from cache`);
      }

      // Load actions
      const actionsFile = path.join(this.pluginDir, 'actions.json');
      if (fs.existsSync(actionsFile)) {
        const actionsData = JSON.parse(fs.readFileSync(actionsFile, 'utf8'));
        for (const action of actionsData) {
          const key = `${action.pluginId}:${action.actionId}`;
          this.actions.set(key, action);
        }
        this.logger.info(`Loaded ${this.actions.size} actions from cache`);
      }

      // Load queued data
      this.loadQueuedData();

    } catch (error) {
      this.logger.error('Failed to load plugin cache', { error: error.message });
    }
  }

  /**
   * Load queued data from disk (for offline resilience)
   */
  loadQueuedData() {
    try {
      const queueFile = path.join(this.dataQueueDir, 'pending.json');
      if (fs.existsSync(queueFile)) {
        const queueData = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
        for (const [key, entries] of Object.entries(queueData)) {
          this.dataQueue.set(key, entries);
        }
        this.logger.info(`Loaded ${this.dataQueue.size} queued data entries`);
      }

      // Load action responses queue
      const responsesFile = path.join(this.actionQueueDir, 'pending.json');
      if (fs.existsSync(responsesFile)) {
        this.actionResponseQueue = JSON.parse(fs.readFileSync(responsesFile, 'utf8'));
        this.logger.info(`Loaded ${this.actionResponseQueue.length} pending action responses`);
      }
    } catch (error) {
      this.logger.error('Failed to load queued data', { error: error.message });
    }
  }

  /**
   * Save monitors and actions to cache
   */
  saveToCache() {
    try {
      // Save monitors
      const monitorsFile = path.join(this.pluginDir, 'monitors.json');
      const monitorsData = Array.from(this.monitors.values());
      fs.writeFileSync(monitorsFile, JSON.stringify(monitorsData, null, 2), { mode: 0o600 });

      // Save actions
      const actionsFile = path.join(this.pluginDir, 'actions.json');
      const actionsData = Array.from(this.actions.values());
      fs.writeFileSync(actionsFile, JSON.stringify(actionsData, null, 2), { mode: 0o600 });

    } catch (error) {
      this.logger.error('Failed to save plugin cache', { error: error.message });
    }
  }

  /**
   * Save queued data to disk (for offline resilience)
   */
  saveQueuedData() {
    try {
      // Save data queue
      const queueFile = path.join(this.dataQueueDir, 'pending.json');
      const queueObj = Object.fromEntries(this.dataQueue);
      fs.writeFileSync(queueFile, JSON.stringify(queueObj, null, 2), { mode: 0o600 });

      // Save action responses
      const responsesFile = path.join(this.actionQueueDir, 'pending.json');
      fs.writeFileSync(responsesFile, JSON.stringify(this.actionResponseQueue, null, 2), { mode: 0o600 });

    } catch (error) {
      this.logger.error('Failed to save queued data', { error: error.message });
    }
  }

  /**
   * Deploy a monitor script from parent
   * @param {Object} config - Monitor configuration
   * @param {string} config.pluginId - Plugin identifier
   * @param {string} config.monitorId - Monitor identifier
   * @param {string} config.script - Base64-encoded script code
   * @param {number} config.interval - Execution interval in milliseconds
   * @param {string[]} config.platforms - Supported platforms
   * @param {string} config.checksum - SHA256 hash of the script
   * @returns {Object} Result of deployment
   */
  deployMonitor(config) {
    const { pluginId, monitorId, script, interval, platforms, checksum } = config;
    const key = `${pluginId}:${monitorId}`;

    this.logger.info('Deploying monitor', { pluginId, monitorId, interval });

    // Check platform support
    if (platforms && !platforms.includes(process.platform)) {
      this.logger.warn('Monitor not supported on this platform', {
        pluginId,
        monitorId,
        platform: process.platform,
        supportedPlatforms: platforms
      });
      return { success: false, error: 'Platform not supported' };
    }

    // Decode and verify script
    let scriptCode;
    try {
      scriptCode = Buffer.from(script, 'base64').toString('utf8');
    } catch (error) {
      this.logger.error('Failed to decode monitor script', { pluginId, monitorId, error: error.message });
      return { success: false, error: 'Invalid script encoding' };
    }

    // Verify checksum
    if (checksum) {
      const actualChecksum = crypto.createHash('sha256').update(scriptCode).digest('hex');
      if (actualChecksum !== checksum) {
        this.logger.error('Monitor script checksum mismatch', {
          pluginId,
          monitorId,
          expected: checksum,
          actual: actualChecksum
        });
        return { success: false, error: 'Checksum verification failed' };
      }
    }

    // Stop existing monitor if running
    if (this.monitorTimers.has(key)) {
      clearInterval(this.monitorTimers.get(key));
      this.monitorTimers.delete(key);
    }

    // Store monitor configuration
    const monitorConfig = {
      pluginId,
      monitorId,
      script: scriptCode,
      interval,
      platforms,
      checksum,
      deployedAt: new Date().toISOString()
    };
    this.monitors.set(key, monitorConfig);

    // Save to cache
    this.saveToCache();

    // Start monitor execution
    this.startMonitor(key, monitorConfig);

    return { success: true, message: 'Monitor deployed successfully' };
  }

  /**
   * Start a monitor execution at specified interval
   * @param {string} key - Monitor key (pluginId:monitorId)
   * @param {Object} config - Monitor configuration
   */
  startMonitor(key, config) {
    const { pluginId, monitorId, interval } = config;

    this.logger.debug('Starting monitor', { pluginId, monitorId, interval });

    // Execute immediately
    this.executeMonitor(pluginId, monitorId);

    // Schedule recurring execution
    const timerId = setInterval(() => {
      this.executeMonitor(pluginId, monitorId);
    }, interval);

    this.monitorTimers.set(key, timerId);
  }

  /**
   * Execute a monitor script and queue the result
   * @param {string} pluginId - Plugin identifier
   * @param {string} monitorId - Monitor identifier
   */
  async executeMonitor(pluginId, monitorId) {
    const key = `${pluginId}:${monitorId}`;
    const monitor = this.monitors.get(key);

    if (!monitor) {
      this.logger.warn('Monitor not found', { pluginId, monitorId });
      return;
    }

    const startTime = Date.now();

    try {
      // Execute script in sandboxed environment
      const result = await this.executeSandboxed(monitor.script, {});

      const executionTime = Date.now() - startTime;
      this.logger.debug('Monitor executed successfully', {
        pluginId,
        monitorId,
        executionTime
      });

      // Queue result for sync
      await this.queueData(pluginId, monitorId, {
        timestamp: Date.now(),
        data: result,
        executionTime
      });

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Monitor execution failed', {
        pluginId,
        monitorId,
        executionTime,
        error: error.message
      });

      // Queue error for reporting
      await this.queueData(pluginId, monitorId, {
        timestamp: Date.now(),
        error: error.message,
        executionTime
      });
    }
  }

  /**
   * Deploy an action script from parent
   * @param {Object} config - Action configuration
   * @param {string} config.pluginId - Plugin identifier
   * @param {string} config.actionId - Action identifier
   * @param {string} config.script - Base64-encoded script code
   * @param {string[]} config.platforms - Supported platforms
   * @param {string} config.checksum - SHA256 hash of the script
   * @returns {Object} Result of deployment
   */
  deployAction(config) {
    const { pluginId, actionId, script, platforms, checksum } = config;
    const key = `${pluginId}:${actionId}`;

    this.logger.info('Deploying action', { pluginId, actionId });

    // Check platform support
    if (platforms && !platforms.includes(process.platform)) {
      this.logger.warn('Action not supported on this platform', {
        pluginId,
        actionId,
        platform: process.platform,
        supportedPlatforms: platforms
      });
      return { success: false, error: 'Platform not supported' };
    }

    // Decode and verify script
    let scriptCode;
    try {
      scriptCode = Buffer.from(script, 'base64').toString('utf8');
    } catch (error) {
      this.logger.error('Failed to decode action script', { pluginId, actionId, error: error.message });
      return { success: false, error: 'Invalid script encoding' };
    }

    // Verify checksum
    if (checksum) {
      const actualChecksum = crypto.createHash('sha256').update(scriptCode).digest('hex');
      if (actualChecksum !== checksum) {
        this.logger.error('Action script checksum mismatch', {
          pluginId,
          actionId,
          expected: checksum,
          actual: actualChecksum
        });
        return { success: false, error: 'Checksum verification failed' };
      }
    }

    // Store action configuration
    const actionConfig = {
      pluginId,
      actionId,
      script: scriptCode,
      platforms,
      checksum,
      deployedAt: new Date().toISOString()
    };
    this.actions.set(key, actionConfig);

    // Save to cache
    this.saveToCache();

    return { success: true, message: 'Action deployed successfully' };
  }

  /**
   * Trigger an action execution
   * @param {Object} trigger - Action trigger configuration
   * @param {string} trigger.pluginId - Plugin identifier
   * @param {string} trigger.actionId - Action identifier
   * @param {string} trigger.triggerId - Unique trigger identifier
   * @param {Object} trigger.arguments - Arguments to pass to the action
   * @returns {Object} Result of trigger
   */
  async triggerAction(trigger) {
    const { pluginId, actionId, triggerId, arguments: args } = trigger;
    const key = `${pluginId}:${actionId}`;
    const action = this.actions.get(key);

    if (!action) {
      this.logger.warn('Action not found', { pluginId, actionId });
      return {
        triggerId,
        status: 'error',
        error: 'Action not deployed',
        executedAt: Date.now()
      };
    }

    this.logger.info('Triggering action', { pluginId, actionId, triggerId });

    const startTime = Date.now();
    let response;

    try {
      // Execute action script with arguments
      const result = await this.executeSandboxed(action.script, args || {});

      const executionTime = Date.now() - startTime;
      this.logger.info('Action executed successfully', {
        pluginId,
        actionId,
        triggerId,
        executionTime
      });

      response = {
        triggerId,
        pluginId,
        actionId,
        status: 'success',
        returnCode: 0,
        output: result,
        error: null,
        executedAt: Date.now(),
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Action execution failed', {
        pluginId,
        actionId,
        triggerId,
        executionTime,
        error: error.message
      });

      response = {
        triggerId,
        pluginId,
        actionId,
        status: 'failure',
        returnCode: 1,
        output: null,
        error: error.message,
        executedAt: Date.now(),
        executionTime
      };
    }

    // Queue response for debounced batch sync
    this.queueActionResponse(response);

    return response;
  }

  /**
   * Execute script in a sandboxed environment
   * @param {string} script - Script code to execute
   * @param {Object} args - Arguments to pass to the script
   * @returns {Promise<any>} Script result
   */
  async executeSandboxed(script, args) {
    return new Promise((resolve, reject) => {
      try {
        // Create sandbox context with limited API access
        const sandbox = {
          // Arguments passed to the script
          args,

          // Basic utilities
          console: {
            log: (...msgs) => this.logger.debug('[sandbox]', ...msgs),
            warn: (...msgs) => this.logger.warn('[sandbox]', ...msgs),
            error: (...msgs) => this.logger.error('[sandbox]', ...msgs)
          },

          // Safe built-ins
          JSON,
          Date,
          Math,
          parseInt,
          parseFloat,
          encodeURIComponent,
          decodeURIComponent,

          // Platform info
          platform: process.platform,
          arch: process.arch,

          // Result callback
          __resolve: resolve,
          __reject: reject,

          // OS utilities (limited)
          os: {
            hostname: () => {
              const os = require('os');
              return os.hostname();
            },
            platform: () => process.platform,
            arch: () => process.arch,
            userInfo: () => {
              const os = require('os');
              const info = os.userInfo();
              return { username: info.username, homedir: info.homedir };
            }
          },

          // File system (read-only, limited paths)
          fs: {
            existsSync: (p) => {
              // Only allow checking certain paths
              if (this.isPathAllowed(p)) {
                return fs.existsSync(p);
              }
              return false;
            },
            readFileSync: (p, opts) => {
              if (this.isPathAllowed(p)) {
                return fs.readFileSync(p, opts);
              }
              throw new Error('Path not allowed');
            }
          },

          // Child process (limited, for platform commands)
          exec: (cmd, opts) => {
            return this.safeExec(cmd, opts);
          },

          // Require stub (returns null for most)
          require: (moduleName) => {
            const allowed = ['os', 'path'];
            if (allowed.includes(moduleName)) {
              if (moduleName === 'os') return sandbox.os;
              if (moduleName === 'path') return require('path');
            }
            return null;
          }
        };

        // Wrap script to return result
        const wrappedScript = `
          (async function() {
            try {
              const scriptFn = ${script};
              const result = typeof scriptFn === 'function' ? await scriptFn(args) : scriptFn;
              __resolve(result);
            } catch (e) {
              __reject(e);
            }
          })();
        `;

        // Create VM context and run
        const context = vm.createContext(sandbox);
        vm.runInContext(wrappedScript, context, {
          timeout: this.scriptTimeout,
          filename: 'plugin-script.js'
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Check if a file path is allowed for sandbox access
   * @param {string} filePath - Path to check
   * @returns {boolean}
   */
  isPathAllowed(filePath) {
    // Allow reading from certain directories
    const allowedPaths = [
      '/tmp',
      '/var/log',
      process.env.TEMP || 'C:\\Windows\\Temp',
      process.env.HOME,
      process.env.USERPROFILE
    ].filter(Boolean);

    const normalizedPath = path.normalize(filePath);
    return allowedPaths.some(allowed => normalizedPath.startsWith(allowed));
  }

  /**
   * Execute a command safely with restrictions
   * @param {string} cmd - Command to execute
   * @param {Object} opts - Execution options
   * @returns {Promise<Object>}
   */
  safeExec(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');

      // Restrict certain dangerous commands
      const dangerous = ['rm -rf', 'del /s', 'format', 'mkfs', 'dd if='];
      if (dangerous.some(d => cmd.toLowerCase().includes(d))) {
        reject(new Error('Command not allowed'));
        return;
      }

      exec(cmd, {
        timeout: opts.timeout || 30000,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({ error: error.message, stdout, stderr, exitCode: error.code });
        } else {
          resolve({ stdout, stderr, exitCode: 0 });
        }
      });
    });
  }

  /**
   * Queue monitor data for sync to parent
   * @param {string} pluginId - Plugin identifier
   * @param {string} monitorId - Monitor identifier
   * @param {Object} data - Data to queue
   */
  async queueData(pluginId, monitorId, data) {
    const key = `${pluginId}:${monitorId}`;

    if (!this.dataQueue.has(key)) {
      this.dataQueue.set(key, []);
    }

    this.dataQueue.get(key).push(data);

    // Persist to disk for offline resilience
    this.saveQueuedData();

    this.logger.debug('Data queued for sync', { pluginId, monitorId, queueSize: this.dataQueue.get(key).length });
  }

  /**
   * Queue action response with debouncing
   * @param {Object} response - Action response
   */
  queueActionResponse(response) {
    this.actionResponseQueue.push(response);

    // Persist to disk
    this.saveQueuedData();

    // Reset debounce timer
    if (this.responseDebounceTimer) {
      clearTimeout(this.responseDebounceTimer);
    }

    // Set debounce timer (responses within 2 seconds are batched)
    this.responseDebounceTimer = setTimeout(() => {
      this.logger.debug('Action response debounce complete', {
        responseCount: this.actionResponseQueue.length
      });
    }, this.responseDebounceMs);
  }

  /**
   * Get all queued plugin data for sync
   * @returns {Object} Batched plugin data
   */
  getQueuedData() {
    const pluginData = {};

    for (const [key, entries] of this.dataQueue.entries()) {
      const [pluginId, monitorId] = key.split(':');

      if (!pluginData[pluginId]) {
        pluginData[pluginId] = {};
      }

      pluginData[pluginId][monitorId] = entries;
    }

    return pluginData;
  }

  /**
   * Get all queued action responses
   * @returns {Array} Action responses
   */
  getQueuedActionResponses() {
    return [...this.actionResponseQueue];
  }

  /**
   * Clear queued data after successful sync
   * @param {string[]} keys - Keys to clear (pluginId:monitorId)
   */
  clearQueuedData(keys = null) {
    if (keys) {
      for (const key of keys) {
        this.dataQueue.delete(key);
      }
    } else {
      this.dataQueue.clear();
    }

    this.saveQueuedData();
    this.logger.debug('Queued data cleared', { keys });
  }

  /**
   * Clear action responses after successful sync
   * @param {string[]} triggerIds - Trigger IDs to clear
   */
  clearActionResponses(triggerIds = null) {
    if (triggerIds) {
      this.actionResponseQueue = this.actionResponseQueue.filter(
        r => !triggerIds.includes(r.triggerId)
      );
    } else {
      this.actionResponseQueue = [];
    }

    this.saveQueuedData();
    this.logger.debug('Action responses cleared', { triggerIds });
  }

  /**
   * Remove a deployed monitor
   * @param {string} pluginId - Plugin identifier
   * @param {string} monitorId - Monitor identifier
   * @returns {boolean}
   */
  removeMonitor(pluginId, monitorId) {
    const key = `${pluginId}:${monitorId}`;

    // Stop timer if running
    if (this.monitorTimers.has(key)) {
      clearInterval(this.monitorTimers.get(key));
      this.monitorTimers.delete(key);
    }

    // Remove from registry
    const removed = this.monitors.delete(key);

    if (removed) {
      this.saveToCache();
      this.logger.info('Monitor removed', { pluginId, monitorId });
    }

    return removed;
  }

  /**
   * Remove a deployed action
   * @param {string} pluginId - Plugin identifier
   * @param {string} actionId - Action identifier
   * @returns {boolean}
   */
  removeAction(pluginId, actionId) {
    const key = `${pluginId}:${actionId}`;
    const removed = this.actions.delete(key);

    if (removed) {
      this.saveToCache();
      this.logger.info('Action removed', { pluginId, actionId });
    }

    return removed;
  }

  /**
   * Get status of all deployed monitors and actions
   * @returns {Object}
   */
  getStatus() {
    const monitors = [];
    for (const [key, config] of this.monitors.entries()) {
      monitors.push({
        pluginId: config.pluginId,
        monitorId: config.monitorId,
        interval: config.interval,
        running: this.monitorTimers.has(key),
        deployedAt: config.deployedAt
      });
    }

    const actions = [];
    for (const [key, config] of this.actions.entries()) {
      actions.push({
        pluginId: config.pluginId,
        actionId: config.actionId,
        deployedAt: config.deployedAt
      });
    }

    return {
      monitors,
      actions,
      dataQueueSize: this.dataQueue.size,
      actionResponseQueueSize: this.actionResponseQueue.length
    };
  }

  /**
   * Start all monitors (called on agent startup)
   */
  startAllMonitors() {
    this.logger.info('Starting all monitors');

    for (const [key, config] of this.monitors.entries()) {
      if (!this.monitorTimers.has(key)) {
        this.startMonitor(key, config);
      }
    }
  }

  /**
   * Stop all monitors (called on agent shutdown)
   */
  stopAllMonitors() {
    this.logger.info('Stopping all monitors');

    for (const [key, timerId] of this.monitorTimers.entries()) {
      clearInterval(timerId);
    }

    this.monitorTimers.clear();
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('PluginExtensionManager shutting down');

    // Stop all monitors
    this.stopAllMonitors();

    // Clear debounce timer
    if (this.responseDebounceTimer) {
      clearTimeout(this.responseDebounceTimer);
    }

    // Save any pending data
    this.saveQueuedData();
    this.saveToCache();
  }
}

export default PluginExtensionManager;
