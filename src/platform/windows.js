import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Windows platform-specific process management
 */
export default {
  /**
   * Check if a process is running
   */
  async isProcessRunning(processName) {
    try {
      // Ensure processName has .exe extension for Windows
      const exeName = processName.endsWith('.exe') ? processName : `${processName}.exe`;

      const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${exeName}" /NH`);

      // Check if the process name appears in the output
      return stdout.toLowerCase().includes(exeName.toLowerCase());
    } catch (error) {
      // tasklist returns error code if process not found
      return false;
    }
  },

  /**
   * Kill a process by name
   */
  async killProcess(processName) {
    try {
      const exeName = processName.endsWith('.exe') ? processName : `${processName}.exe`;

      // /F = force termination, /IM = image name
      await execPromise(`taskkill /F /IM ${exeName}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to kill process ${processName}: ${error.message}`);
    }
  },

  /**
   * Get list of running processes
   */
  async getProcessList() {
    try {
      // Get process list in CSV format for easier parsing
      const { stdout } = await execPromise('tasklist /FO CSV /NH');

      const processes = [];
      const lines = stdout.split('\n').filter(line => line.trim());

      for (const line of lines) {
        // Parse CSV line: "name","pid","session","memory"
        const match = line.match(/"([^"]+)","([^"]+)","([^"]+)","([^"]+)"/);
        if (match) {
          processes.push({
            name: match[1],
            pid: parseInt(match[2], 10),
            session: match[3],
            memory: match[4]
          });
        }
      }

      return processes;
    } catch (error) {
      throw new Error(`Failed to get process list: ${error.message}`);
    }
  },

  /**
   * Get process details by name
   */
  async getProcessInfo(processName) {
    try {
      const exeName = processName.endsWith('.exe') ? processName : `${processName}.exe`;
      const { stdout } = await execPromise(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH /V`);

      const lines = stdout.split('\n').filter(line => line.trim() && line.includes(exeName));
      const processInfos = [];

      for (const line of lines) {
        const parts = line.split('","').map(p => p.replace(/"/g, ''));
        if (parts.length >= 8) {
          processInfos.push({
            name: parts[0],
            pid: parseInt(parts[1], 10),
            session: parts[2],
            memory: parts[4],
            status: parts[5],
            username: parts[6],
            windowTitle: parts[8] || ''
          });
        }
      }

      return processInfos;
    } catch (error) {
      return [];
    }
  },

  /**
   * Get system username
   */
  async getUsername() {
    try {
      const { stdout } = await execPromise('echo %USERNAME%');
      return stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  },

  /**
   * Get hostname
   */
  async getHostname() {
    try {
      const { stdout } = await execPromise('hostname');
      return stdout.trim();
    } catch (error) {
      return 'unknown';
    }
  }
};
