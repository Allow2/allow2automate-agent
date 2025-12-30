import express from 'express';
import jwt from 'jsonwebtoken';
import os from 'os';

/**
 * ApiServer provides REST API for agent management
 */
class ApiServer {
  constructor(configManager, policyEngine, processMonitor, logger, port = 8443) {
    this.configManager = configManager;
    this.policyEngine = policyEngine;
    this.processMonitor = processMonitor;
    this.logger = logger;
    this.port = port;
    this.app = express();
    this.server = null;

    this.setupMiddleware();
    this.setupRoutes();
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

    // Auto-update trigger
    this.app.post('/api/update', async (req, res) => {
      try {
        const { version, downloadUrl } = req.body;
        // TODO: Implement auto-update logic
        res.json({
          message: 'Update initiated',
          version,
          status: 'pending'
        });
      } catch (error) {
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
