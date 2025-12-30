import Bonjour from 'bonjour-service';
import os from 'os';

/**
 * DiscoveryAdvertiser handles mDNS/Bonjour service advertising
 * for automatic discovery by parent applications
 */
class DiscoveryAdvertiser {
  constructor(agentId, apiPort, logger) {
    this.agentId = agentId;
    this.apiPort = apiPort;
    this.logger = logger;
    this.bonjour = null;
    this.service = null;
  }

  /**
   * Start advertising the service via mDNS
   */
  start() {
    try {
      this.bonjour = new Bonjour();

      const serviceName = `allow2-agent-${os.hostname()}`;

      this.service = this.bonjour.publish({
        name: serviceName,
        type: 'allow2',
        port: this.apiPort,
        txt: {
          agentId: this.agentId || 'unconfigured',
          hostname: os.hostname(),
          version: '1.0.0',
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version
        }
      });

      this.logger.info('mDNS service advertising started', {
        name: serviceName,
        port: this.apiPort,
        agentId: this.agentId
      });

      // Handle service errors
      this.service.on('error', (error) => {
        this.logger.error('mDNS service error', { error: error.message });
      });

    } catch (error) {
      this.logger.error('Failed to start mDNS advertising', { error: error.message });
      throw error;
    }
  }

  /**
   * Stop advertising the service
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.service) {
        resolve();
        return;
      }

      try {
        this.service.stop(() => {
          this.logger.info('mDNS service advertising stopped');

          if (this.bonjour) {
            this.bonjour.destroy();
            this.bonjour = null;
          }

          this.service = null;
          resolve();
        });
      } catch (error) {
        this.logger.error('Error stopping mDNS service', { error: error.message });
        resolve(); // Resolve anyway to allow shutdown
      }
    });
  }

  /**
   * Update service TXT records (e.g., when agentId is configured)
   */
  updateTxtRecords(updates) {
    if (!this.service) {
      this.logger.warn('Cannot update TXT records: service not running');
      return false;
    }

    try {
      // Restart service with updated information
      this.stop().then(() => {
        if (updates.agentId) {
          this.agentId = updates.agentId;
        }
        this.start();
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to update TXT records', { error: error.message });
      return false;
    }
  }

  /**
   * Find other Allow2 agents on the network
   */
  findAgents(timeout = 5000) {
    return new Promise((resolve) => {
      const agents = [];
      const browser = this.bonjour.find({ type: 'allow2' });

      browser.on('up', (service) => {
        this.logger.debug('Discovered agent', {
          name: service.name,
          host: service.host,
          port: service.port,
          txt: service.txt
        });

        agents.push({
          name: service.name,
          host: service.host,
          port: service.port,
          agentId: service.txt?.agentId,
          hostname: service.txt?.hostname,
          platform: service.txt?.platform,
          version: service.txt?.version
        });
      });

      // Stop browsing after timeout
      setTimeout(() => {
        browser.stop();
        resolve(agents);
      }, timeout);
    });
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.service !== null,
      agentId: this.agentId,
      port: this.apiPort,
      hostname: os.hostname()
    };
  }
}

export default DiscoveryAdvertiser;
