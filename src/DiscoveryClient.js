import Bonjour from 'bonjour-service';

/**
 * DiscoveryClient finds Allow2Automate parent instances via mDNS
 */
class DiscoveryClient {
  constructor(logger) {
    this.logger = logger;
    this.bonjour = null;
  }

  /**
   * Find parent instance by UUID via mDNS
   * @param {string} hostUuid - The UUID of the parent to find
   * @param {number} timeout - How long to search (ms)
   * @returns {Promise<{host: string, port: number}|null>}
   */
  async findParentByUuid(hostUuid, timeout = 10000) {
    return new Promise((resolve) => {
      if (!hostUuid) {
        this.logger.warn('Cannot discover parent: host_uuid not configured');
        resolve(null);
        return;
      }

      this.logger.info('Starting mDNS discovery for parent', { hostUuid, timeout });

      this.bonjour = new Bonjour();
      let found = false;

      // Browse for Allow2Automate services
      const browser = this.bonjour.find({ type: 'allow2automate', protocol: 'tcp' });

      browser.on('up', (service) => {
        this.logger.debug('Discovered Allow2Automate instance', {
          name: service.name,
          host: service.host,
          port: service.port,
          txt: service.txt
        });

        // Check if this service matches our host_uuid
        const serviceUuid = service.txt?.uuid || service.txt?.UUID;

        if (serviceUuid === hostUuid) {
          this.logger.info('Found matching parent via mDNS', {
            host: service.host,
            port: service.port,
            uuid: serviceUuid
          });

          found = true;
          browser.stop();
          this.cleanup();

          resolve({
            host: service.host,
            port: service.port
          });
        }
      });

      // Stop after timeout if not found
      setTimeout(() => {
        if (!found) {
          this.logger.warn('mDNS discovery timeout - parent not found', { hostUuid });
          browser.stop();
          this.cleanup();
          resolve(null);
        }
      }, timeout);
    });
  }

  /**
   * List all Allow2Automate instances on network (for debugging)
   * @param {number} timeout - How long to search (ms)
   * @returns {Promise<Array>}
   */
  async listAllInstances(timeout = 5000) {
    return new Promise((resolve) => {
      this.logger.info('Discovering all Allow2Automate instances on network');

      this.bonjour = new Bonjour();
      const instances = [];

      const browser = this.bonjour.find({ type: 'allow2automate', protocol: 'tcp' });

      browser.on('up', (service) => {
        instances.push({
          name: service.name,
          host: service.host,
          port: service.port,
          uuid: service.txt?.uuid || service.txt?.UUID,
          txt: service.txt
        });

        this.logger.debug('Found instance', {
          host: service.host,
          port: service.port,
          uuid: service.txt?.uuid
        });
      });

      setTimeout(() => {
        browser.stop();
        this.cleanup();
        this.logger.info(`Found ${instances.length} Allow2Automate instances`);
        resolve(instances);
      }, timeout);
    });
  }

  /**
   * Cleanup bonjour instance
   */
  cleanup() {
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
  }
}

export default DiscoveryClient;
