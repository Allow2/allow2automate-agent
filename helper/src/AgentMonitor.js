/**
 * Agent Monitor
 * Communicates with the main agent service to get status
 */

import fetch from 'node-fetch';

export default class AgentMonitor {
  constructor(agentUrl) {
    this.agentUrl = agentUrl;
  }

  async getStatus() {
    try {
      const response = await fetch(`${this.agentUrl}/api/helper/status`, {
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'Allow2-Agent-Helper/1.0'
        }
      });

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
      // Agent service not reachable
      return {
        connected: false,
        parentConnected: false,
        error: error.message
      };
    }
  }

  async sendCommand(command, params = {}) {
    try {
      const response = await fetch(`${this.agentUrl}/api/helper/command`, {
        method: 'POST',
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Allow2-Agent-Helper/1.0'
        },
        body: JSON.stringify({
          command,
          params
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();

    } catch (error) {
      console.error(`[AgentMonitor] Command '${command}' failed:`, error);
      throw error;
    }
  }
}
