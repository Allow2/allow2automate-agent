#!/usr/bin/env node

/**
 * Allow2 Automate Agent - Main Entry Point
 * System service for process monitoring and parental controls
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import process from 'process';
import { v4 as uuidv4 } from 'uuid';

// Import core modules
import ConfigManager from './ConfigManager.js';
import Logger from './Logger.js';
import PolicyEngine from './PolicyEngine.js';
import ProcessMonitor from './ProcessMonitor.js';
import ApiServer from './ApiServer.js';
import AutoUpdater from './AutoUpdater.js';
import PluginExtensionManager from './PluginExtensionManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Agent class - orchestrates all services
 */
class Allow2AutomateAgent {
  constructor() {
    this.configManager = null;
    this.logger = null;
    this.policyEngine = null;
    this.processMonitor = null;
    this.apiServer = null;
    this.autoUpdater = null;
    this.pluginExtensionManager = null;
    this.isShuttingDown = false;
  }

  /**
   * Initialize all components
   */
  async initialize() {
    console.log('=== Allow2 Automate Agent ===');
    console.log('Version: 1.0.0');
    console.log('Platform:', process.platform);
    console.log('');

    // Initialize configuration
    this.configManager = new ConfigManager();
    console.log('Configuration loaded from:', this.configManager.configPath);

    // Initialize logger
    this.logger = new Logger(this.configManager.get('logLevel') || 'info');
    this.logger.info('=== Starting Allow2 Automate Agent ===', {
      version: '1.0.0',
      platform: process.platform,
      nodeVersion: process.version
    });

    // Generate agent ID if not set
    if (!this.configManager.get('agentId')) {
      const agentId = uuidv4();
      this.configManager.set('agentId', agentId);
      this.logger.info('Generated new agent ID', { agentId });
    }

    // Initialize policy engine
    this.policyEngine = new PolicyEngine(this.configManager, this.logger);
    this.logger.info('Policy engine initialized');

    // Get platform-specific process handler
    const platform = await this.getPlatform();

    // Initialize process monitor
    const checkInterval = this.configManager.get('checkInterval') || 30000;
    this.processMonitor = new ProcessMonitor(
      this.policyEngine,
      platform,
      this.logger,
      checkInterval
    );
    this.logger.info('Process monitor initialized', { checkInterval });

    // Initialize API server (agent listens on port 8443 for local helper app)
    const apiPort = 8443;
    this.apiServer = new ApiServer(
      this.configManager,
      this.policyEngine,
      this.processMonitor,
      this.logger,
      apiPort
    );
    this.logger.info('API server initialized', { port: apiPort });

    // Note: Agent does NOT advertise via mDNS
    // It only discovers the parent via mDNS (handled in PolicyEngine)

    // Initialize plugin extension manager
    this.pluginExtensionManager = new PluginExtensionManager(this.configManager, this.logger);
    this.logger.info('Plugin extension manager initialized');

    // Initialize auto-updater with policy engine reference
    this.autoUpdater = new AutoUpdater(this.configManager, this.logger, this.policyEngine);
    this.logger.info('Auto-updater initialized');

    // Wire up component dependencies
    this.policyEngine.setPluginExtensionManager(this.pluginExtensionManager);
    this.apiServer.setPluginExtensionManager(this.pluginExtensionManager);
    this.apiServer.setAutoUpdater(this.autoUpdater);
  }

  /**
   * Get platform-specific process module
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
   * Start all services
   */
  async start() {
    try {
      // Start API server (for local helper app only)
      await this.apiServer.start();
      this.logger.info('API server started');

      // Sync policies if configured
      // (PolicyEngine will use mDNS to discover parent if enabled)
      if (this.configManager.isConfigured()) {
        this.logger.info('Agent is configured, syncing policies...');
        await this.policyEngine.syncFromParent();
      } else {
        this.logger.warn('Agent is not configured. Waiting for parent pairing...');
        this.logger.info('To configure, use the parent app to discover and pair this agent');
      }

      // Start process monitoring
      await this.processMonitor.start();
      this.logger.info('Process monitoring started');

      // Start plugin monitors
      this.pluginExtensionManager.startAllMonitors();
      this.logger.info('Plugin monitors started');

      // Start auto-update checking if enabled
      if (this.configManager.get('autoUpdate')) {
        this.autoUpdater.startAutoCheck();
        this.logger.info('Auto-update checking started');
      }

      this.logger.info('=== Allow2 Automate Agent is running ===');
      this.logStatus();

    } catch (error) {
      this.logger.error('Failed to start agent', { error: error.message });
      throw error;
    }
  }

  /**
   * Log current status
   */
  logStatus() {
    const agentId = this.configManager.get('agentId');
    const configured = this.configManager.isConfigured();
    const policies = this.policyEngine.getAllPolicies();
    const pluginStatus = this.pluginExtensionManager.getStatus();

    this.logger.info('Agent Status:', {
      agentId,
      configured,
      policyCount: policies.length,
      apiServer: this.apiServer.isRunning(),
      monitoring: this.processMonitor.isRunning,
      pluginMonitors: pluginStatus.monitors.length,
      pluginActions: pluginStatus.actions.length
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(signal) {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      // Stop auto-updater
      if (this.autoUpdater) {
        this.autoUpdater.stopAutoCheck();
      }

      // Stop plugin extension manager
      if (this.pluginExtensionManager) {
        await this.pluginExtensionManager.shutdown();
        this.logger.info('Plugin extension manager stopped');
      }

      // Stop process monitoring
      if (this.processMonitor) {
        await this.processMonitor.stop();
        this.logger.info('Process monitor stopped');
      }

      // Stop API server
      if (this.apiServer) {
        await this.apiServer.stop();
        this.logger.info('API server stopped');
      }

      this.logger.info('=== Allow2 Automate Agent stopped ===');
      process.exit(0);
    } catch (error) {
      this.logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  setupSignalHandlers() {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack
      });
      this.shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled promise rejection', {
        reason: reason,
        promise: promise
      });
    });
  }
}

/**
 * Main entry point
 */
async function main() {
  const agent = new Allow2AutomateAgent();

  try {
    await agent.initialize();
    agent.setupSignalHandlers();
    await agent.start();
  } catch (error) {
    console.error('Failed to start agent:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default Allow2AutomateAgent;
