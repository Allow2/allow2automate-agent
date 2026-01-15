import express from 'express';
import jwt from 'jsonwebtoken';
import os from 'os';

/**
 * ApiServer provides REST API for agent management
 */
class ApiServer {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./PolicyEngine.js').default} policyEngine
   * @param {import('./ProcessMonitor.js').default} processMonitor
   * @param {import('./Logger.js').default} logger
   * @param {number} port
   */
  constructor(configManager, policyEngine, processMonitor, logger, port = 8443) {
    this.configManager = configManager;
    this.policyEngine = policyEngine;
    this.processMonitor = processMonitor;
    this.logger = logger;
    this.port = port;
    this.app = express();
    this.server = null;

    // Optional components (set after construction)
    this.pluginExtensionManager = null;
    this.autoUpdater = null;

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set plugin extension manager reference
   * @param {import('./PluginExtensionManager.js').default} pluginExtensionManager
   */
  setPluginExtensionManager(pluginExtensionManager) {
    this.pluginExtensionManager = pluginExtensionManager;
  }

  /**
   * Set auto updater reference
   * @param {import('./AutoUpdater.js').default} autoUpdater
   */
  setAutoUpdater(autoUpdater) {
    this.autoUpdater = autoUpdater;
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      this.logger.debug(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
      next();
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      this.logger.error('API error', {
        error: err.message,
        path: req.path,
        method: req.method
      });

      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check (no auth required)
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        version: this.configManager.get('version'),
        agentId: this.configManager.get('agentId'),
        hostname: os.hostname(),
        platform: process.platform,
        uptime: process.uptime(),
        monitoringActive: this.processMonitor.isRunning
      });
    });

    // Heartbeat (no auth required for discovery)
    this.app.post('/api/heartbeat', (req, res) => {
      res.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        agentId: this.configManager.get('agentId')
      });
    });

    // Platform users discovery (no auth required)
    this.app.get('/api/platform-users', async (req, res) => {
      try {
        const users = await this.getPlatformUsers();
        res.json({ users });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Helper status endpoint (no auth required - localhost only)
    this.app.get('/api/helper/status', (req, res) => {
      try {
        const isConfigured = this.configManager.isConfigured();
        const host = this.configManager.get('host');
        const port = this.configManager.get('port');
        const parentUrl = (host && port) ? `http://${host}:${port}` : null;
        const agentId = this.configManager.get('agentId');
        const lastHeartbeat = this.policyEngine.getLastSyncTime();

        // Check if we've successfully connected to parent recently
        const now = Date.now();
        const lastSync = lastHeartbeat ? new Date(lastHeartbeat).getTime() : 0;
        const timeSinceSync = now - lastSync;
        const parentConnected = isConfigured && timeSinceSync < 120000; // Connected if synced in last 2 minutes

        res.json({
          connected: true,
          parentConnected,
          parentUrl: parentUrl || null,
          agentId: agentId || null,
          hostname: os.hostname(),
          version: this.configManager.get('version') || '1.0.0',
          uptime: Math.floor(process.uptime()),
          lastHeartbeat: lastHeartbeat || null,
          configured: isConfigured,
          monitoringActive: this.processMonitor.isRunning,
          errors: []
        });
      } catch (error) {
        this.logger.error('Helper status error', { error: error.message });
        res.status(500).json({
          connected: true,
          parentConnected: false,
          errors: [{
            type: 'status_error',
            message: error.message
          }]
        });
      }
    });

    // Helper command endpoint (no auth required - localhost only)
    this.app.post('/api/helper/command', async (req, res) => {
      try {
        const { command, params } = req.body;

        switch (command) {
          case 'sync':
            await this.policyEngine.syncFromParent();
            res.json({ success: true, message: 'Policies synced' });
            break;

          case 'restart_monitoring':
            await this.processMonitor.stop();
            await this.processMonitor.start();
            res.json({ success: true, message: 'Monitoring restarted' });
            break;

          default:
            res.status(400).json({ error: 'Unknown command' });
        }
      } catch (error) {
        this.logger.error('Helper command error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // All routes below require authentication
    this.app.use('/api', this.authenticateJWT.bind(this));

    // Policy management
    this.app.post('/api/policies', async (req, res) => {
      try {
        const policy = await this.policyEngine.createPolicy(req.body);
        res.status(201).json(policy);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.get('/api/policies', async (req, res) => {
      try {
        const policies = this.policyEngine.getAllPolicies();
        res.json({ policies });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/policies/:id', async (req, res) => {
      try {
        const policy = this.policyEngine.getPolicy(req.params.id);
        if (!policy) {
          return res.status(404).json({ error: 'Policy not found' });
        }
        res.json(policy);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.patch('/api/policies/:id', async (req, res) => {
      try {
        const policy = await this.policyEngine.updatePolicy(req.params.id, req.body);
        res.json(policy);
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    this.app.delete('/api/policies/:id', async (req, res) => {
      try {
        const deleted = await this.policyEngine.deletePolicy(req.params.id);
        if (!deleted) {
          return res.status(404).json({ error: 'Policy not found' });
        }
        res.status(204).send();
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Sync policies from parent
    this.app.post('/api/sync', async (req, res) => {
      try {
        const success = await this.policyEngine.syncFromParent();
        res.json({ success, timestamp: new Date().toISOString() });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Configuration management
    this.app.get('/api/config', (req, res) => {
      const config = this.configManager.getAll();
      // Remove sensitive data
      delete config.authToken;
      res.json(config);
    });

    this.app.patch('/api/config', (req, res) => {
      try {
        const updated = this.configManager.update(req.body);
        if (!updated) {
          return res.status(500).json({ error: 'Failed to update configuration' });
        }
        res.json({ success: true });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Process monitoring control
    this.app.get('/api/monitor/status', (req, res) => {
      const status = this.processMonitor.getStatus();
      res.json(status);
    });

    this.app.post('/api/monitor/start', async (req, res) => {
      try {
        await this.processMonitor.start();
        res.json({ status: 'started' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/monitor/stop', async (req, res) => {
      try {
        await this.processMonitor.stop();
        res.json({ status: 'stopped' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Auto-update trigger (enhanced)
    this.app.post('/api/update', async (req, res) => {
      try {
        const { version, downloadUrl, checksum, latestVersion } = req.body;

        if (!this.autoUpdater) {
          return res.status(503).json({ error: 'Auto-updater not available' });
        }

        // Build update info from request
        const updateInfo = {
          latestVersion: latestVersion || version,
          downloadUrl,
          checksum,
          updateAvailable: true,
          autoUpdate: true
        };

        const result = await this.autoUpdater.triggerUpdate(updateInfo);

        res.json({
          message: result.success ? 'Update initiated' : 'Update failed',
          version: latestVersion || version,
          status: result.success ? 'pending' : 'failed',
          error: result.error
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ========================================
    // Plugin Extension Endpoints
    // ========================================

    // Deploy a monitor script from parent
    this.app.post('/api/plugin/deploy-monitor', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { pluginId, monitorId, script, interval, platforms, checksum } = req.body;

        if (!pluginId || !monitorId || !script) {
          return res.status(400).json({ error: 'Missing required fields: pluginId, monitorId, script' });
        }

        const result = this.pluginExtensionManager.deployMonitor({
          pluginId,
          monitorId,
          script,
          interval: interval || 30000, // Default 30 seconds
          platforms,
          checksum
        });

        if (result.success) {
          res.status(201).json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error) {
        this.logger.error('Deploy monitor error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Deploy an action script from parent
    this.app.post('/api/plugin/deploy-action', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { pluginId, actionId, script, platforms, checksum } = req.body;

        if (!pluginId || !actionId || !script) {
          return res.status(400).json({ error: 'Missing required fields: pluginId, actionId, script' });
        }

        const result = this.pluginExtensionManager.deployAction({
          pluginId,
          actionId,
          script,
          platforms,
          checksum
        });

        if (result.success) {
          res.status(201).json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (error) {
        this.logger.error('Deploy action error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Trigger action execution
    this.app.post('/api/plugin/trigger-action', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { pluginId, actionId, triggerId, arguments: args } = req.body;

        if (!pluginId || !actionId || !triggerId) {
          return res.status(400).json({ error: 'Missing required fields: pluginId, actionId, triggerId' });
        }

        const result = await this.pluginExtensionManager.triggerAction({
          pluginId,
          actionId,
          triggerId,
          arguments: args || {}
        });

        res.json(result);
      } catch (error) {
        this.logger.error('Trigger action error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Get queued plugin data for sync
    this.app.get('/api/plugin/data', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const pluginData = this.pluginExtensionManager.getQueuedData();
        const actionResponses = this.pluginExtensionManager.getQueuedActionResponses();

        res.json({
          agentId: this.configManager.get('agentId'),
          pluginData,
          actionResponses,
          timestamp: Date.now()
        });
      } catch (error) {
        this.logger.error('Get plugin data error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Clear queued data after successful sync
    this.app.post('/api/plugin/data/clear', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { dataKeys, triggerIds } = req.body;

        if (dataKeys) {
          this.pluginExtensionManager.clearQueuedData(dataKeys);
        }

        if (triggerIds) {
          this.pluginExtensionManager.clearActionResponses(triggerIds);
        }

        res.json({ success: true });
      } catch (error) {
        this.logger.error('Clear plugin data error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Get plugin extension status
    this.app.get('/api/plugin/status', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const status = this.pluginExtensionManager.getStatus();
        res.json(status);
      } catch (error) {
        this.logger.error('Get plugin status error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Remove a deployed monitor
    this.app.delete('/api/plugin/monitor/:pluginId/:monitorId', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { pluginId, monitorId } = req.params;
        const removed = this.pluginExtensionManager.removeMonitor(pluginId, monitorId);

        if (removed) {
          res.status(204).send();
        } else {
          res.status(404).json({ error: 'Monitor not found' });
        }
      } catch (error) {
        this.logger.error('Remove monitor error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Remove a deployed action
    this.app.delete('/api/plugin/action/:pluginId/:actionId', async (req, res) => {
      try {
        if (!this.pluginExtensionManager) {
          return res.status(503).json({ error: 'Plugin extension manager not available' });
        }

        const { pluginId, actionId } = req.params;
        const removed = this.pluginExtensionManager.removeAction(pluginId, actionId);

        if (removed) {
          res.status(204).send();
        } else {
          res.status(404).json({ error: 'Action not found' });
        }
      } catch (error) {
        this.logger.error('Remove action error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Process list
    this.app.get('/api/processes', async (req, res) => {
      try {
        const platform = await this.getPlatform();
        const processes = await platform.getProcessList();
        res.json({ processes });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * JWT authentication middleware
   */
  authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.split(' ')[1]; // Bearer <token>

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      // Verify token using configured auth token as secret
      const secret = this.configManager.get('authToken');
      if (!secret) {
        return res.status(401).json({ error: 'Agent not configured' });
      }

      const decoded = jwt.verify(token, secret);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid token' });
    }
  }

  /**
   * Get platform-specific module
   */
  async getPlatform() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return (await import('./platform/windows.js')).default;
      case 'darwin':
        return (await import('./platform/darwin.js')).default;
      default:
        return (await import('./platform/linux.js')).default;
    }
  }

  /**
   * Get platform users (for account linking)
   */
  async getPlatformUsers() {
    const platform = process.platform;

    try {
      if (platform === 'win32') {
        // Windows: Get local users
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execPromise = promisify(exec);
        const { stdout } = await execPromise('net user');

        // Parse user list from output
        const lines = stdout.split('\n');
        const users = [];
        let inUserSection = false;

        for (const line of lines) {
          if (line.includes('---')) {
            inUserSection = true;
            continue;
          }
          if (inUserSection && line.trim()) {
            const userNames = line.trim().split(/\s+/);
            users.push(...userNames.filter(u => u.length > 0));
          }
          if (line.includes('The command completed')) {
            break;
          }
        }

        return users;
      } else {
        // macOS/Linux: Get users from /etc/passwd
        const fs = await import('fs');
        const passwd = fs.readFileSync('/etc/passwd', 'utf8');
        const users = passwd
          .split('\n')
          .filter(line => line.trim())
          .map(line => line.split(':')[0])
          .filter(user => !user.startsWith('_') && user !== 'root');

        return users;
      }
    } catch (error) {
      this.logger.error('Failed to get platform users', { error: error.message });
      return [];
    }
  }

  /**
   * Start the API server
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.logger.info(`API server listening on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          if (error.code === 'EADDRINUSE') {
            this.logger.error(`Port ${this.port} is already in use`);
          } else {
            this.logger.error('Server error', { error: error.message });
          }
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the API server
   */
  async stop() {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.logger.info('API server stopped');
        resolve();
      });
    });
  }

  /**
   * Get server status
   */
  isRunning() {
    return this.server !== null && this.server.listening;
  }
}

export default ApiServer;
