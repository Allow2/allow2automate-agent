import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * AutoUpdater handles automatic updates of the agent
 *
 * Features:
 * - Check for updates from parent API (POST /api/agent/check-update)
 * - Download installer from parent with checksum verification
 * - Platform-specific installer execution (Windows .exe, macOS .pkg, Linux .deb)
 * - Graceful process exit for installer to restart service
 * - Retry logic with exponential backoff
 */
class AutoUpdater {
  /**
   * @param {import('./ConfigManager.js').default} configManager
   * @param {import('./Logger.js').default} logger
   * @param {import('./PolicyEngine.js').default} policyEngine - Optional, for parent connection
   */
  constructor(configManager, logger, policyEngine = null) {
    this.configManager = configManager;
    this.logger = logger;
    this.policyEngine = policyEngine;
    this.currentVersion = configManager.get('version') || '1.0.0';
    this.updateCheckInterval = 6 * 60 * 60 * 1000; // 6 hours (per spec)
    this.initialCheckDelay = 30000; // 30 seconds after startup
    this.checkTimer = null;
    this.updateInProgress = false;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds initial, exponential backoff
  }

  /**
   * Set policy engine reference (for parent connection discovery)
   * @param {import('./PolicyEngine.js').default} policyEngine
   */
  setPolicyEngine(policyEngine) {
    this.policyEngine = policyEngine;
  }

  /**
   * Start automatic update checking
   */
  startAutoCheck() {
    if (this.checkTimer) {
      this.logger.warn('Auto-update check already running');
      return;
    }

    this.logger.info('Auto-update checking started', {
      interval: this.updateCheckInterval,
      initialDelay: this.initialCheckDelay
    });

    // Run initial check after delay (per spec: 30 seconds after startup)
    setTimeout(() => {
      this.checkForUpdates();
    }, this.initialCheckDelay);

    // Schedule recurring checks (every 6 hours per spec)
    this.checkTimer = setInterval(() => {
      this.checkForUpdates();
    }, this.updateCheckInterval);
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
   * Get parent connection info (via PolicyEngine or config)
   * @returns {Promise<{host: string, port: number}|null>}
   */
  async getParentConnection() {
    // Try PolicyEngine first (uses mDNS discovery)
    if (this.policyEngine && typeof this.policyEngine.getParentConnection === 'function') {
      const connection = await this.policyEngine.getParentConnection();
      if (connection) {
        return connection;
      }
    }

    // Fallback to configured host/port
    const host = this.configManager.get('host');
    const port = this.configManager.get('port');

    if (host && port) {
      return { host, port };
    }

    return null;
  }

  /**
   * Check for available updates from parent API
   * Uses POST /api/agent/check-update endpoint per spec
   */
  async checkForUpdates() {
    if (this.updateInProgress) {
      this.logger.debug('Update already in progress, skipping check');
      return null;
    }

    const authToken = this.configManager.get('authToken');
    const agentId = this.configManager.get('agentId');

    if (!authToken || !agentId) {
      this.logger.debug('Cannot check for updates: not configured');
      return null;
    }

    // Get parent connection
    const parentConnection = await this.getParentConnection();
    if (!parentConnection) {
      this.logger.debug('Cannot check updates: parent not reachable');
      return null;
    }

    const parentUrl = `http://${parentConnection.host}:${parentConnection.port}`;

    try {
      // Per spec: POST /api/agent/check-update with X-Agent-Version header
      const response = await fetch(`${parentUrl}/api/agent/check-update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json',
          'X-Agent-Version': this.currentVersion,
          'X-Agent-Platform': process.platform
        },
        body: JSON.stringify({
          agentId,
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
          currentVersion: updateInfo.currentVersion || this.currentVersion,
          latestVersion: updateInfo.latestVersion,
          autoUpdate: updateInfo.autoUpdate
        });

        // Check if auto-update is enabled (parent preference or local config)
        const shouldAutoUpdate = updateInfo.autoUpdate || this.configManager.get('autoUpdate');

        if (shouldAutoUpdate) {
          await this.downloadAndInstallUpdate(parentUrl, updateInfo);
        } else {
          this.logger.info('Update available but auto-update disabled');
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
   * Download and install update from parent
   * @param {string} parentUrl - Parent API base URL
   * @param {Object} updateInfo - Update information from check-update response
   */
  async downloadAndInstallUpdate(parentUrl, updateInfo) {
    if (this.updateInProgress) {
      this.logger.warn('Update already in progress');
      return;
    }

    this.updateInProgress = true;
    const { latestVersion, downloadUrl, checksum, releaseNotes } = updateInfo;

    this.logger.info('Starting update download', {
      version: latestVersion,
      releaseNotes: releaseNotes ? 'available' : 'none'
    });

    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        // Prepare download location
        const tempDir = this.getTempDirectory();
        const installerExt = this.getInstallerExtension();
        const installerPath = path.join(
          tempDir,
          `allow2automate-agent-update-${latestVersion}${installerExt}`
        );

        // Download installer
        const fullDownloadUrl = downloadUrl.startsWith('http')
          ? downloadUrl
          : `${parentUrl}${downloadUrl}`;

        this.logger.info('Downloading installer', { url: fullDownloadUrl, attempt });

        const response = await fetch(fullDownloadUrl, {
          headers: {
            'Authorization': `Bearer ${this.configManager.get('authToken')}`
          }
        });

        if (!response.ok) {
          throw new Error(`Download failed: HTTP ${response.status}`);
        }

        // Check disk space before saving
        await this.checkDiskSpace(tempDir);

        // Save to disk
        const buffer = await response.buffer();
        fs.writeFileSync(installerPath, buffer);

        this.logger.info('Installer downloaded', {
          path: installerPath,
          size: buffer.length
        });

        // Verify checksum
        if (checksum) {
          const actualChecksum = this.calculateChecksum(installerPath);
          if (actualChecksum !== checksum) {
            fs.unlinkSync(installerPath); // Clean up
            throw new Error('Checksum verification failed - download corrupted');
          }
          this.logger.info('Checksum verified successfully');
        }

        // Make installer executable (macOS/Linux)
        if (process.platform !== 'win32') {
          fs.chmodSync(installerPath, 0o755);
        }

        // Run installer
        await this.runInstaller(installerPath, process.platform);

        // If we get here without exit, something went wrong
        this.updateInProgress = false;
        return;

      } catch (error) {
        lastError = error;
        this.logger.warn(`Update attempt ${attempt} failed`, {
          error: error.message,
          retriesLeft: this.maxRetries - attempt
        });

        if (attempt < this.maxRetries) {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    this.updateInProgress = false;
    this.logger.error('Update failed after all retries', {
      error: lastError?.message
    });
  }

  /**
   * Perform the update (legacy method for compatibility)
   * @deprecated Use downloadAndInstallUpdate instead
   */
  async performUpdate(updateInfo) {
    const parentConnection = await this.getParentConnection();
    if (!parentConnection) {
      throw new Error('No parent connection available');
    }
    const parentUrl = `http://${parentConnection.host}:${parentConnection.port}`;
    return this.downloadAndInstallUpdate(parentUrl, updateInfo);
  }

  /**
   * Check available disk space
   * @param {string} dir - Directory to check
   * @throws {Error} If insufficient disk space
   */
  async checkDiskSpace(dir) {
    try {
      const os = await import('os');
      // Require at least 100MB free
      const requiredSpace = 100 * 1024 * 1024;

      if (process.platform === 'win32') {
        // Windows: use PowerShell to get free space
        const { stdout } = await execPromise(
          `powershell -Command "(Get-PSDrive -Name ${dir[0]}).Free"`
        );
        const freeSpace = parseInt(stdout.trim());
        if (freeSpace < requiredSpace) {
          throw new Error(`Insufficient disk space: ${Math.round(freeSpace / 1024 / 1024)}MB available, ${Math.round(requiredSpace / 1024 / 1024)}MB required`);
        }
      } else {
        // Unix: use df
        const { stdout } = await execPromise(`df -k "${dir}" | tail -1 | awk '{print $4}'`);
        const freeSpaceKB = parseInt(stdout.trim()) * 1024;
        if (freeSpaceKB < requiredSpace) {
          throw new Error(`Insufficient disk space: ${Math.round(freeSpaceKB / 1024 / 1024)}MB available, ${Math.round(requiredSpace / 1024 / 1024)}MB required`);
        }
      }
    } catch (error) {
      if (error.message.includes('Insufficient disk space')) {
        throw error;
      }
      // Log warning but don't fail on disk check errors
      this.logger.warn('Could not check disk space', { error: error.message });
    }
  }

  /**
   * Calculate file checksum
   * @param {string} filePath - Path to file
   * @param {string} algorithm - Hash algorithm (default: sha256)
   * @returns {string} Hex-encoded checksum
   */
  calculateChecksum(filePath, algorithm = 'sha256') {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash(algorithm).update(buffer).digest('hex');
  }

  /**
   * Run platform-specific installer and exit for restart
   * @param {string} installerPath - Path to installer file
   * @param {string} platform - Platform identifier
   */
  async runInstaller(installerPath, platform) {
    this.logger.info('Launching installer', { platform, path: installerPath });

    return new Promise((resolve, reject) => {
      let installerProcess;

      switch (platform) {
        case 'win32':
          // Windows: Run .exe with /SILENT /UPDATE flags
          // Uses spawn with detached to survive agent exit
          installerProcess = spawn(installerPath, ['/SILENT', '/UPDATE'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });
          break;

        case 'darwin':
          // macOS: Run .pkg with installer command
          // Note: This requires root privileges
          installerProcess = spawn('installer', [
            '-pkg', installerPath,
            '-target', '/',
            '-verboseR'
          ], {
            detached: true,
            stdio: 'ignore'
          });
          break;

        default:
          // Linux: Run .deb/.rpm with appropriate package manager
          const isSudo = process.getuid && process.getuid() === 0;
          if (!isSudo) {
            reject(new Error('Update requires root privileges'));
            return;
          }

          if (installerPath.endsWith('.deb')) {
            installerProcess = spawn('dpkg', ['-i', installerPath], {
              detached: true,
              stdio: 'ignore'
            });
          } else if (installerPath.endsWith('.rpm')) {
            installerProcess = spawn('rpm', ['-U', installerPath], {
              detached: true,
              stdio: 'ignore'
            });
          } else {
            reject(new Error(`Unsupported installer type: ${path.extname(installerPath)}`));
            return;
          }
          break;
      }

      // Detach process so it survives agent exit
      installerProcess.unref();

      this.logger.info('Installer launched, agent will restart shortly');

      // Give installer time to start, then exit gracefully
      setTimeout(() => {
        this.logger.info('Exiting for update...');
        process.exit(0); // Installer will restart agent service
      }, 2000);

      resolve();
    });
  }

  /**
   * Sleep helper for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Download installer from parent (legacy method)
   * @deprecated Use downloadAndInstallUpdate instead
   */
  async downloadInstaller(downloadUrl, version) {
    const parentConnection = await this.getParentConnection();
    if (!parentConnection) {
      throw new Error('No parent connection available');
    }

    const parentUrl = `http://${parentConnection.host}:${parentConnection.port}`;
    const authToken = this.configManager.get('authToken');

    const url = downloadUrl.startsWith('http') ? downloadUrl : `${parentUrl}${downloadUrl}`;

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
   * Verify installer checksum (legacy method)
   */
  async verifyChecksum(filePath, expectedChecksum, algorithm = 'sha256') {
    try {
      const actualChecksum = this.calculateChecksum(filePath, algorithm);
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
   * Trigger update manually (called from API endpoint)
   * @param {Object} updateInfo - Update information
   * @returns {Promise<Object>}
   */
  async triggerUpdate(updateInfo) {
    if (this.updateInProgress) {
      return { success: false, error: 'Update already in progress' };
    }

    const parentConnection = await this.getParentConnection();
    if (!parentConnection) {
      return { success: false, error: 'No parent connection available' };
    }

    const parentUrl = `http://${parentConnection.host}:${parentConnection.port}`;

    try {
      await this.downloadAndInstallUpdate(parentUrl, updateInfo);
      return { success: true, message: 'Update initiated' };
    } catch (error) {
      return { success: false, error: error.message };
    }
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
