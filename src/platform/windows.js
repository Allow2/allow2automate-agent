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
  },

  /**
   * Get current logged-in user information
   */
  async getCurrentUser() {
    try {
      // Get current console user (query user shows who's logged into console)
      const { stdout: queryOut } = await execPromise('query user');
      const lines = queryOut.split('\n').filter(l => l.trim());

      // Find active console session (contains 'console' or has '>')
      let activeUserLine = null;
      for (const line of lines) {
        if (line.includes('>') || line.toLowerCase().includes('console')) {
          activeUserLine = line;
          break;
        }
      }

      if (!activeUserLine) {
        return null; // No active console user
      }

      // Parse user info from query output
      const parts = activeUserLine.trim().replace('>', '').split(/\s+/);
      const username = parts[0];

      // Get user SID (Security Identifier)
      let userId = null;
      try {
        const { stdout: sidOut } = await execPromise('powershell -command "([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value"');
        userId = sidOut.trim();
      } catch (error) {
        userId = null;
      }

      // Get full name from user account
      let accountName = username;
      try {
        const { stdout: nameOut } = await execPromise(`wmic useraccount where name="${username}" get fullname /value`);
        const match = nameOut.match(/FullName=(.+)/);
        if (match && match[1].trim()) {
          accountName = match[1].trim();
        }
      } catch (error) {
        // Keep username as fallback
      }

      // Check if workstation is locked
      let isActive = true;
      try {
        const { stdout: lockCheck } = await execPromise('tasklist /FI "IMAGENAME eq LogonUI.exe" /NH');
        isActive = !lockCheck.toLowerCase().includes('logonui.exe');
      } catch (error) {
        // Assume active if we can't determine
        isActive = true;
      }

      // Get login time from event log (last boot time as approximation)
      let sessionStartTime = null;
      try {
        const { stdout: bootTime } = await execPromise('wmic os get lastbootuptime /value');
        const match = bootTime.match(/LastBootUpTime=(\d{14})/);
        if (match) {
          const timestamp = match[1];
          const year = timestamp.substring(0, 4);
          const month = timestamp.substring(4, 6);
          const day = timestamp.substring(6, 8);
          const hour = timestamp.substring(8, 10);
          const minute = timestamp.substring(10, 12);
          const second = timestamp.substring(12, 14);
          sessionStartTime = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
        }
      } catch (error) {
        sessionStartTime = new Date().toISOString();
      }

      return {
        username,
        userId,
        accountName,
        isActive,
        sessionStartTime: sessionStartTime || new Date().toISOString(),
        lastActivityTime: new Date().toISOString()
      };

    } catch (error) {
      console.error('Failed to get current user:', error.message);
      return null;
    }
  }
};
