#!/usr/bin/env node
/**
 * Allow2 Automate Agent - User Space Helper
 *
 * This helper runs in the user's session (not as root/system) and provides:
 * - System tray icon with status indicator
 * - Desktop notifications for warnings and alerts
 * - Connection status monitoring
 *
 * It communicates with the main agent service via HTTP on localhost.
 */

import TrayManager from './TrayManager.js';
import AgentMonitor from './AgentMonitor.js';
import NotificationManager from './NotificationManager.js';

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://localhost:8443';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 10000; // 10 seconds

class AgentHelper {
  constructor() {
    this.trayManager = null;
    this.agentMonitor = null;
    this.notificationManager = null;
    this.lastStatus = null;
    this.checkTimer = null;
  }

  async start() {
    console.log('[AgentHelper] Starting Allow2 Automate Agent Helper...');
    console.log(`[AgentHelper] Monitoring agent at: ${AGENT_SERVICE_URL}`);

    try {
      // Initialize notification manager
      this.notificationManager = new NotificationManager();

      // Initialize agent monitor
      this.agentMonitor = new AgentMonitor(AGENT_SERVICE_URL);

      // Initialize system tray
      this.trayManager = new TrayManager({
        onStatusClick: () => this.showStatus(),
        onIssuesClick: () => this.showIssues(),
        onQuit: () => this.shutdown()
      });

      await this.trayManager.initialize();
      console.log('[AgentHelper] System tray initialized');

      // Start monitoring
      this.startMonitoring();

      // Show startup notification
      this.notificationManager.notify({
        title: 'Allow2 Agent Helper',
        message: 'Monitoring agent connection...',
        icon: 'info'
      });

    } catch (error) {
      console.error('[AgentHelper] Failed to start:', error);
      process.exit(1);
    }
  }

  startMonitoring() {
    // Check immediately
    this.checkAgentStatus();

    // Then check periodically
    this.checkTimer = setInterval(() => {
      this.checkAgentStatus();
    }, CHECK_INTERVAL);
  }

  async checkAgentStatus() {
    try {
      const status = await this.agentMonitor.getStatus();

      // Update tray icon based on status
      if (status.connected) {
        if (status.parentConnected) {
          this.trayManager.setStatus('connected', 'Connected to Allow2');
        } else {
          this.trayManager.setStatus('warning', 'Agent running, not connected to parent');
        }
      } else {
        this.trayManager.setStatus('disconnected', 'Agent service not running');
      }

      // Detect status changes and notify
      this.handleStatusChange(status);

      this.lastStatus = status;

    } catch (error) {
      console.error('[AgentHelper] Error checking status:', error);
      this.trayManager.setStatus('error', 'Error checking agent status');
    }
  }

  handleStatusChange(newStatus) {
    if (!this.lastStatus) return;

    // Agent went offline
    if (this.lastStatus.connected && !newStatus.connected) {
      this.notificationManager.notify({
        title: 'Allow2 Agent Disconnected',
        message: 'The Allow2 agent service is not running',
        icon: 'error',
        sound: true
      });
    }

    // Agent came online
    if (!this.lastStatus.connected && newStatus.connected) {
      this.notificationManager.notify({
        title: 'Allow2 Agent Connected',
        message: 'Agent service is now running',
        icon: 'success'
      });
    }

    // Parent connection lost
    if (this.lastStatus.parentConnected && !newStatus.parentConnected) {
      this.notificationManager.notify({
        title: 'Parent Connection Lost',
        message: 'Cannot reach Allow2 parent server',
        icon: 'warning',
        sound: true
      });
    }

    // Parent connection restored
    if (!this.lastStatus.parentConnected && newStatus.parentConnected) {
      this.notificationManager.notify({
        title: 'Parent Connection Restored',
        message: 'Connected to Allow2 parent server',
        icon: 'success'
      });
    }
  }

  showStatus() {
    const status = this.lastStatus || { connected: false };

    let message = '=== Allow2 Agent Status ===\n\n';
    message += `Agent Service: ${status.connected ? 'Running ✓' : 'Not Running ✗'}\n`;

    if (status.connected) {
      message += `Parent Server: ${status.parentConnected ? 'Connected ✓' : 'Disconnected ✗'}\n`;
      if (status.parentUrl) {
        message += `Parent URL: ${status.parentUrl}\n`;
      }
      if (status.agentId) {
        message += `Agent ID: ${status.agentId}\n`;
      }
      if (status.hostname) {
        message += `Hostname: ${status.hostname}\n`;
      }
      message += `Last Check: ${new Date().toLocaleTimeString()}\n`;
    }

    console.log(message);

    // Show notification with status
    this.notificationManager.notify({
      title: 'Allow2 Agent Status',
      message: status.connected ?
        (status.parentConnected ? 'All systems operational' : 'Agent running, parent disconnected') :
        'Agent service not running',
      icon: status.connected && status.parentConnected ? 'success' : 'warning'
    });
  }

  showIssues() {
    const status = this.lastStatus || { connected: false };
    const issues = [];

    if (!status.connected) {
      issues.push({
        severity: 'error',
        title: 'Agent Service Not Running',
        description: 'The Allow2 agent background service is not running. Process monitoring and parental controls are inactive.',
        resolution: 'Try restarting your computer or reinstalling the agent.'
      });
    } else if (!status.parentConnected) {
      issues.push({
        severity: 'warning',
        title: 'Parent Server Disconnected',
        description: 'The agent cannot reach the Allow2 parent server. Offline policies are in effect.',
        resolution: 'Check your internet connection. The agent will automatically reconnect when the server is reachable.'
      });
    }

    if (status.errors && status.errors.length > 0) {
      status.errors.forEach(error => {
        issues.push({
          severity: 'error',
          title: error.type || 'Agent Error',
          description: error.message,
          resolution: error.resolution || 'Please check the agent logs for more details.'
        });
      });
    }

    if (issues.length === 0) {
      console.log('\n=== No Issues Detected ===\n');
      console.log('All systems operational ✓');

      this.notificationManager.notify({
        title: 'Allow2 Status',
        message: 'No issues detected - all systems operational',
        icon: 'success'
      });
    } else {
      console.log('\n=== Issues Detected ===\n');
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. [${issue.severity.toUpperCase()}] ${issue.title}`);
        console.log(`   ${issue.description}`);
        console.log(`   → ${issue.resolution}\n`);
      });

      // Show notification for most severe issue
      const mostSevere = issues.find(i => i.severity === 'error') || issues[0];
      this.notificationManager.notify({
        title: mostSevere.title,
        message: mostSevere.description,
        icon: mostSevere.severity,
        sound: true
      });
    }
  }

  shutdown() {
    console.log('[AgentHelper] Shutting down...');

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    if (this.trayManager) {
      this.trayManager.destroy();
    }

    process.exit(0);
  }
}

// Handle shutdown signals
process.on('SIGINT', () => {
  console.log('[AgentHelper] Received SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[AgentHelper] Received SIGTERM');
  process.exit(0);
});

// Start the helper
const helper = new AgentHelper();
helper.start().catch(error => {
  console.error('[AgentHelper] Fatal error:', error);
  process.exit(1);
});
