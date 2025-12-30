import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Logger utility using Winston
 */
class Logger {
  constructor(logLevel = 'info') {
    this.logDir = this.getLogDirectory();
    this.ensureLogDirectory();

    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        // Console output
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              let metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
              return `${timestamp} [${level}] ${message} ${metaStr}`;
            })
          )
        }),
        // File output
        new winston.transports.File({
          filename: path.join(this.logDir, 'agent.log'),
          maxsize: 10485760, // 10MB
          maxFiles: 5
        }),
        // Error file
        new winston.transports.File({
          filename: path.join(this.logDir, 'error.log'),
          level: 'error',
          maxsize: 10485760,
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Get platform-specific log directory
   */
  getLogDirectory() {
    const platform = process.platform;
    switch (platform) {
      case 'win32':
        return path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Allow2', 'agent', 'logs');
      case 'darwin':
        return '/Library/Logs/Allow2/agent';
      default: // linux
        return '/var/log/allow2/agent';
    }
  }

  /**
   * Ensure log directory exists
   */
  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true, mode: 0o755 });
    }
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  setLevel(level) {
    this.logger.level = level;
  }
}

export default Logger;
