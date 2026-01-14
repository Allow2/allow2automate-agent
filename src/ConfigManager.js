import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * ConfigManager handles loading, saving, and managing agent configuration
 */
class ConfigManager {
  constructor(configPath = null) {
    // Determine config path based on platform
    if (configPath) {
      this.configPath = configPath;
    } else {
      this.configPath = this.getDefaultConfigPath();
    }

    this.config = this.load();
  }

  /**
   * Get platform-specific default config path
   */
  getDefaultConfigPath() {
    const platform = process.platform;
    let configDir;

    switch (platform) {
      case 'win32':
        configDir = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Allow2', 'agent');
        break;
      case 'darwin':
        configDir = '/Library/Application Support/Allow2/agent';
        break;
      default: // linux
        configDir = '/etc/allow2/agent';
    }

    // Ensure directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
    }

    return path.join(configDir, 'config.json');
  }

  /**
   * Load configuration from file or return defaults
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(data);
        return { ...this.getDefaultConfig(), ...config };
      }
    } catch (error) {
      console.error(`Failed to load config from ${this.configPath}:`, error.message);
    }

    return this.getDefaultConfig();
  }

  /**
   * Get default configuration
   */
  getDefaultConfig() {
    return {
      agentId: null,
      host: null,
      port: null,
      host_uuid: null,
      public_key: null,
      authToken: null,
      checkInterval: 30000,
      logLevel: 'info',
      enableMDNS: true,
      autoUpdate: true,
      policies: [],
      lastSync: null,
      version: '1.0.0'
    };
  }

  /**
   * Save current configuration to file
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        { mode: 0o600 } // Secure permissions - owner only
      );

      return true;
    } catch (error) {
      console.error(`Failed to save config to ${this.configPath}:`, error.message);
      return false;
    }
  }

  /**
   * Get a configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set a configuration value
   */
  set(key, value) {
    this.config[key] = value;
    return this.save();
  }

  /**
   * Update multiple configuration values
   */
  update(updates) {
    this.config = { ...this.config, ...updates };
    return this.save();
  }

  /**
   * Get all configuration
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Reset to default configuration
   */
  reset() {
    this.config = this.getDefaultConfig();
    return this.save();
  }

  /**
   * Check if agent is configured
   */
  isConfigured() {
    return !!(this.config.agentId && this.config.host && this.config.port && this.config.authToken);
  }
}

export default ConfigManager;
