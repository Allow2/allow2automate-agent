import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Linux platform-specific process management
 * Similar to macOS but with some Linux-specific optimizations
 */
export default {
  /**
   * Check if a process is running
   */
  async isProcessRunning(processName) {
    try {
      // Use pgrep for case-insensitive process name search
      const { stdout } = await execPromise(`pgrep -i "${processName}"`);
      return stdout.trim().length > 0;
    } catch (error) {
      // pgrep returns exit code 1 if no processes found
      return false;
    }
  },

  /**
   * Kill a process by name
   */
  async killProcess(processName) {
    try {
      // Use pkill with -9 (SIGKILL) for force termination
      await execPromise(`pkill -9 -i "${processName}"`);
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
      // Use ps with custom format for consistent output
      const { stdout } = await execPromise('ps -Ao pid,comm,user,%cpu,%mem --no-headers');

      const processes = [];
      const lines = stdout.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length >= 5) {
          processes.push({
            pid: parseInt(parts[0], 10),
            name: parts[1],
            user: parts[2],
            cpu: parseFloat(parts[3]),
            memory: parseFloat(parts[4])
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
      const { stdout } = await execPromise(`ps -A | grep -i "${processName}" | grep -v grep`);

      const processInfos = [];
      const lines = stdout.split('\n').filter(line => line.trim());

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          processInfos.push({
            pid: parseInt(parts[0], 10),
            tty: parts[1],
            time: parts[2],
            name: parts.slice(3).join(' ')
          });
        }
      }

      return processInfos;
    } catch (error) {
      return [];
    }
  },

  /**
   * Get detailed process info by PID
   */
  async getProcessDetailsByPID(pid) {
    try {
      const { stdout } = await execPromise(`ps -p ${pid} -o pid,comm,user,%cpu,%mem,lstart --no-headers`);
      const data = stdout.trim().split(/\s+/);

      if (data.length >= 6) {
        return {
          pid: parseInt(data[0], 10),
          name: data[1],
          user: data[2],
          cpu: parseFloat(data[3]),
          memory: parseFloat(data[4]),
          startTime: data.slice(5).join(' ')
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Get system username
   */
  async getUsername() {
    try {
      const { stdout } = await execPromise('whoami');
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
   * Get process command line (Linux-specific via /proc)
   */
  async getProcessCmdline(pid) {
    try {
      const { stdout } = await execPromise(`cat /proc/${pid}/cmdline`);
      // Replace null bytes with spaces
      return stdout.replace(/\0/g, ' ').trim();
    } catch (error) {
      return null;
    }
  },

  /**
   * Get current logged-in user information
   */
  async getCurrentUser() {
    try {
      // Try to get X11/Wayland desktop session user
      let username = null;

      // Method 1: Check who is logged into display :0 (X11)
      try {
        const { stdout: whoOut } = await execPromise('who | grep "(:0)" | awk \'{print $1}\' | head -1');
        username = whoOut.trim();
      } catch (error) {
        // Try loginctl as fallback
      }

      // Method 2: Use loginctl to find graphical session
      if (!username) {
        try {
          const { stdout: sessionsOut } = await execPromise('loginctl list-sessions --no-legend');
          const sessions = sessionsOut.split('\n').filter(l => l.trim());

          for (const session of sessions) {
            const sessionId = session.trim().split(/\s+/)[0];
            const { stdout: sessionInfo } = await execPromise(`loginctl show-session ${sessionId} -p Type -p Name --value`);
            const [type, user] = sessionInfo.trim().split('\n');

            if (type === 'x11' || type === 'wayland') {
              username = user;
              break;
            }
          }
        } catch (error) {
          // Fallback below
        }
      }

      // Method 3: Just get first logged-in user
      if (!username) {
        const { stdout: whoOut } = await execPromise('who | awk \'{print $1}\' | head -1');
        username = whoOut.trim();
      }

      if (!username) {
        return null; // No user logged in
      }

      // Get user ID
      let userId = null;
      try {
        const { stdout: uidOut } = await execPromise(`id -u ${username}`);
        userId = uidOut.trim();
      } catch (error) {
        userId = null;
      }

      // Get full name from /etc/passwd
      let accountName = username;
      try {
        const { stdout: passwdOut } = await execPromise(`getent passwd ${username}`);
        const parts = passwdOut.split(':');
        if (parts.length >= 5) {
          const gecos = parts[4].split(',')[0];
          if (gecos) {
            accountName = gecos;
          }
        }
      } catch (error) {
        // Keep username as fallback
      }

      // Check if screen is locked (check for screensaver or lock screen processes)
      let isActive = true;
      try {
        // Check for common lock screen processes
        const { stdout: lockCheck } = await execPromise('pgrep -x "gnome-screensaver|xscreensaver|i3lock|slock" || echo ""');
        isActive = !lockCheck.trim();

        // Also check loginctl LockedHint if available
        if (isActive) {
          try {
            const { stdout: lockHint } = await execPromise(`loginctl show-user ${username} -p LockedHint --value`);
            isActive = lockHint.trim() !== 'yes';
          } catch (error) {
            // Keep current isActive value
          }
        }
      } catch (error) {
        // Assume active if we can't determine
        isActive = true;
      }

      // Get login time from last command
      let sessionStartTime = null;
      try {
        const { stdout: lastOut } = await execPromise(`last -1 ${username} | head -1`);
        const match = lastOut.match(/\w+\s+\w+\s+\d+\s+\d+:\d+/);
        if (match) {
          sessionStartTime = new Date(match[0]).toISOString();
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
