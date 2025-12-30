import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * AutoUpdater handles automatic updates of the agent
 */
class AutoUpdater {
  constructor(configManager, logger) {
    this.configManager = configManager;
    this.logger = logger;
    this.currentVersion = configManager.get('version') || '1.0.0';
    this.updateCheckInterval = 3600000; // 1 hour
    this.checkTimer = null;
  }

  /**
   * Start automatic update checking
   */
  startAutoCheck() {
    if (this.checkTimer) {
      this.logger.warn('Auto-update check already running');
      return;
    }

    // Run initial check
    this.checkForUpdates();

    // Schedule recurring checks
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, this.updateCheckInterval);

    this.logger.info('Auto-update checking started', {
      interval: this.updateCheckInterval
    });
  }

  /**
   * Stop automatic update checking
   */
  stopAutoCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      this.logger.info('Auto-update checking stopped');
    }
  }

  /**
   * Check for available updates
   */
  async checkForUpdates() {
    const parentApiUrl = this.configManager.get('parentApiUrl');
    const authToken = this.configManager.get('authToken');

    if (!parentApiUrl || !authToken) {
      this.logger.debug('Cannot check for updates: parent API not configured');
      return null;
    }

    try {
      const response = await fetch(`${parentApiUrl}/api/agent/updates/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentVersion: this.currentVersion,
          platform: process.platform,
          arch: process.arch
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const updateInfo = await response.json();

      if (updateInfo.updateAvailable) {
        this.logger.info('Update available', {
          currentVersion: this.currentVersion,
          newVersion: updateInfo.version
        });

        // Auto-update if enabled
        if (this.configManager.get('autoUpdate')) {
          await this.performUpdate(updateInfo);
        }

        return updateInfo;
      } else {
        this.logger.debug('No updates available');
        return null;
      }
    } catch (error) {
      this.logger.error('Failed to check for updates', { error: error.message });
      return null;
    }
  }

  /**
   * Perform the update
   */
  async performUpdate(updateInfo) {
    const { version, downloadUrl, checksum, checksumAlgorithm } = updateInfo;

    this.logger.info('Starting update process', { version });

    try {
      // Download installer
      const installerPath = await this.downloadInstaller(downloadUrl, version);

      // Verify checksum
      if (checksum) {
        const verified = await this.verifyChecksum(installerPath, checksum, checksumAlgorithm);
        if (!verified) {
          throw new Error('Checksum verification failed');
        }
      }

      // Run installer (platform-specific)
      await this.runInstaller(installerPath);

      this.logger.info('Update completed successfully', { version });

      // Service will auto-restart
      return true;
    } catch (error) {
      this.logger.error('Update failed', {
        version,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Download installer from parent
   */
  async downloadInstaller(downloadUrl, version) {
    const parentApiUrl = this.configManager.get('parentApiUrl');
    const authToken = this.configManager.get('authToken');

    const url = downloadUrl.startsWith('http') ? downloadUrl : `${parentApiUrl}${downloadUrl}`;

    this.logger.info('Downloading installer', { url });

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Save to temp directory
      const tempDir = this.getTempDirectory();
      const extension = this.getInstallerExtension();
      const installerPath = path.join(tempDir, `allow2-agent-${version}${extension}`);

      const buffer = await response.buffer();
      fs.writeFileSync(installerPath, buffer);

      this.logger.info('Installer downloaded', { path: installerPath });

      return installerPath;
    } catch (error) {
      this.logger.error('Failed to download installer', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify installer checksum
   */
  async verifyChecksum(filePath, expectedChecksum, algorithm = 'sha256') {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const hash = crypto.createHash(algorithm);
      hash.update(fileBuffer);
      const actualChecksum = hash.digest('hex');

      const verified = actualChecksum === expectedChecksum;

      this.logger.info('Checksum verification', {
        verified,
        algorithm,
        expected: expectedChecksum,
        actual: actualChecksum
      });

      return verified;
    } catch (error) {
      this.logger.error('Checksum verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Run installer (platform-specific)
   */
  async runInstaller(installerPath) {
    const platform = process.platform;

    try {
      switch (platform) {
        case 'win32':
          await this.runWindowsInstaller(installerPath);
          break;
        case 'darwin':
          await this.runMacOSInstaller(installerPath);
          break;
        default: // linux
          await this.runLinuxInstaller(installerPath);
          break;
      }
    } catch (error) {
      this.logger.error('Failed to run installer', { error: error.message });
      throw error;
    }
  }

  /**
   * Run Windows MSI installer
   */
  async runWindowsInstaller(installerPath) {
    // Run MSI silently with auto-restart
    const command = `msiexec /i "${installerPath}" /quiet /qn /norestart`;
    this.logger.info('Running Windows installer', { command });
    await execPromise(command);
  }

  /**
   * Run macOS PKG installer
   */
  async runMacOSInstaller(installerPath) {
    // Run PKG installer
    const command = `sudo installer -pkg "${installerPath}" -target /`;
    this.logger.info('Running macOS installer', { command });
    await execPromise(command);
  }

  /**
   * Run Linux installer (DEB or RPM)
   */
  async runLinuxInstaller(installerPath) {
    const extension = path.extname(installerPath);
    let command;

    if (extension === '.deb') {
      command = `sudo dpkg -i "${installerPath}"`;
    } else if (extension === '.rpm') {
      command = `sudo rpm -U "${installerPath}"`;
    } else {
      throw new Error(`Unsupported installer type: ${extension}`);
    }

    this.logger.info('Running Linux installer', { command });
    await execPromise(command);
  }

  /**
   * Get platform-specific temp directory
   */
  getTempDirectory() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return process.env.TEMP || 'C:\\Windows\\Temp';
      case 'darwin':
        return '/tmp';
      default:
        return '/tmp';
    }
  }

  /**
   * Get platform-specific installer extension
   */
  getInstallerExtension() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return '.msi';
      case 'darwin':
        return '.pkg';
      default:
        return '.deb'; // Default to .deb for Linux
    }
  }

  /**
   * Get update status
   */
  getStatus() {
    return {
      currentVersion: this.currentVersion,
      autoUpdateEnabled: this.configManager.get('autoUpdate'),
      checkInterval: this.updateCheckInterval,
      isChecking: this.checkTimer !== null
    };
  }
}

export default AutoUpdater;
