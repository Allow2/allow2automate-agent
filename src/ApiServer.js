import express from 'express';
import os from 'os';

/**
 * ApiServer provides REST API for local helper app ONLY
 *
 * SECURITY: This server ONLY serves localhost requests from the helper app.
 * The agent does NOT accept any connections from the Allow2Automate parent app.
 * All communication with parent is OUTBOUND ONLY via polling in PolicyEngine.
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

    // SECURITY: Only allow localhost connections
    this.app.use((req, res, next) => {
      const clientIp = req.ip || req.connection.remoteAddress;
      const isLocalhost = clientIp === '127.0.0.1' ||
                          clientIp === '::1' ||
                          clientIp === '::ffff:127.0.0.1' ||
                          clientIp === 'localhost';

      if (!isLocalhost) {
        this.logger.warn('Rejected non-localhost connection', { ip: clientIp, path: req.path });
        return res.status(403).json({ error: 'Forbidden - localhost only' });
      }

      next();
    });

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
   * Setup API routes - LOCALHOST ONLY for helper app
   *
   * NOTE: The agent does NOT expose any endpoints for the parent app to call.
   * All communication with parent is OUTBOUND via polling in PolicyEngine.
   */
  setupRoutes() {
    // Health check (for helper app)
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        version: this.configManager.get('version') || '1.0.0',
        agentId: this.configManager.get('agentId'),
        hostname: os.hostname(),
        platform: process.platform,
        uptime: process.uptime(),
        monitoringActive: this.processMonitor.isRunning
      });
    });

    // Heartbeat (for helper app keepalive)
    this.app.post('/api/heartbeat', (req, res) => {
      res.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        agentId: this.configManager.get('agentId')
      });
    });

    // Platform users discovery (for helper app display)
    this.app.get('/api/platform-users', async (req, res) => {
      try {
        const users = await this.getPlatformUsers();
        res.json({ users });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Helper status endpoint - primary interface for helper app
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

        // Get policy count
        const policies = this.policyEngine.getAllPolicies();

        // Get plugin status if available
        let pluginStatus = null;
        if (this.pluginExtensionManager) {
          pluginStatus = this.pluginExtensionManager.getStatus();
        }

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
          policyCount: policies.length,
          pluginMonitors: pluginStatus?.monitors?.length || 0,
          pluginActions: pluginStatus?.actions?.length || 0,
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

    // Helper command endpoint - for helper app to trigger local actions
    this.app.post('/api/helper/command', async (req, res) => {
      try {
        const { command, params } = req.body;

        switch (command) {
          case 'sync':
            // Trigger immediate sync with parent
            await this.policyEngine.syncFromParent();
            res.json({ success: true, message: 'Sync triggered' });
            break;

          case 'restart_monitoring':
            await this.processMonitor.stop();
            await this.processMonitor.start();
            res.json({ success: true, message: 'Monitoring restarted' });
            break;

          case 'check_update':
            // Trigger update check
            if (this.autoUpdater) {
              const updateInfo = await this.autoUpdater.checkForUpdate();
              res.json({ success: true, updateInfo });
            } else {
              res.json({ success: false, message: 'Auto-updater not available' });
            }
            break;

          case 'get_policies':
            // Get current policies for display
            const policies = this.policyEngine.getAllPolicies();
            res.json({ success: true, policies });
            break;

          case 'get_processes':
            // Get running processes
            const platform = await this.getPlatform();
            const processes = await platform.getProcessList();
            res.json({ success: true, processes });
            break;

          default:
            res.status(400).json({ error: 'Unknown command' });
        }
      } catch (error) {
        this.logger.error('Helper command error', { error: error.message });
        res.status(500).json({ error: error.message });
      }
    });

    // Catch-all for any other routes - reject them
    this.app.use('*', (req, res) => {
      this.logger.warn('Rejected request to non-existent endpoint', {
        method: req.method,
        path: req.originalUrl
      });
      res.status(404).json({
        error: 'Not found',
        message: 'This agent only serves localhost helper requests. All parent communication is outbound-only.'
      });
    });
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
   * Get platform users (for account linking display in helper)
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
   * Start the API server (localhost only)
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // SECURITY: Bind to localhost only, not 0.0.0.0
        this.server = this.app.listen(this.port, '127.0.0.1', () => {
          this.logger.info(`API server listening on localhost:${this.port} (helper app only)`);
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
