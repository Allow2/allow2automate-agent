/**
 * Agent Monitor
 * Communicates with the main agent service to get status
 * Uses Node.js built-in fetch (Node 18+)
 */

'use strict';

class AgentMonitor {
  constructor(agentUrl) {
    this.agentUrl = agentUrl;
  }

  async getStatus() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.agentUrl}/api/helper/status`, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Allow2-Agent-Helper/1.0'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      return {
        connected: true,
        parentConnected: data.parentConnected || false,
        parentUrl: data.parentUrl || null,
        agentId: data.agentId || null,
        hostname: data.hostname || null,
        version: data.version || null,
        uptime: data.uptime || 0,
        errors: data.errors || [],
        lastHeartbeat: data.lastHeartbeat || null
      };

    } catch (error) {
      clearTimeout(timeoutId);
      // Agent service not reachable
      return {
        connected: false,
        parentConnected: false,
        error: error.message
      };
    }
  }

  async sendCommand(command, params = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${this.agentUrl}/api/helper/command`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Allow2-Agent-Helper/1.0'
        },
        body: JSON.stringify({
          command,
          params
        })
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();

    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`[AgentMonitor] Command '${command}' failed:`, error);
      throw error;
    }
  }
}

module.exports = AgentMonitor;
