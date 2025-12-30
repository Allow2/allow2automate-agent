/**
 * Mock platform utilities for testing
 */

export function mockWindowsProcesses(processes) {
  const header = `
Image Name                     PID Session Name        Session#    Mem Usage
========================= ======== ================ =========== ============`;

  const lines = processes.map(p => {
    const name = p.name.padEnd(25);
    const pid = String(p.pid).padStart(8);
    const mem = (p.mem || '50,000 K').padStart(12);
    return `${name} ${pid} Console                    1 ${mem}`;
  });

  return header + '\n' + lines.join('\n');
}

export function mockDarwinProcesses(processes) {
  const header = '  PID COMMAND';
  const lines = processes.map(p => {
    return ` ${String(p.pid).padStart(4)} ${p.name}`;
  });

  return header + '\n' + lines.join('\n');
}

export function createMockPlatform(type = 'windows') {
  const runningProcesses = [];

  return {
    name: type,
    platform: type === 'windows' ? 'win32' : 'darwin',

    getRunningProcesses: jest.fn(async () => {
      return [...runningProcesses];
    }),

    killProcess: jest.fn(async (name, pid) => {
      const index = runningProcesses.findIndex(p =>
        p.name === name || p.pid === pid
      );
      if (index !== -1) {
        runningProcesses.splice(index, 1);
        return true;
      }
      return false;
    }),

    // Test helpers
    addProcess: (name, pid) => {
      runningProcesses.push({ name, pid });
    },

    removeProcess: (name) => {
      const index = runningProcesses.findIndex(p => p.name === name);
      if (index !== -1) {
        runningProcesses.splice(index, 1);
      }
    },

    clearProcesses: () => {
      runningProcesses.length = 0;
    },

    getProcesses: () => [...runningProcesses]
  };
}

export function mockProcessKill(processName, success = true) {
  return jest.fn(async (name, pid) => {
    if (name === processName || pid === processName) {
      return success;
    }
    return true;
  });
}

export function mockExecCommand(commandMap) {
  return jest.fn((cmd, callback) => {
    for (const [pattern, result] of Object.entries(commandMap)) {
      if (cmd.includes(pattern)) {
        if (result.error) {
          callback(result.error, null);
        } else {
          callback(null, {
            stdout: result.stdout || '',
            stderr: result.stderr || ''
          });
        }
        return;
      }
    }
    callback(new Error('Unknown command'), null);
  });
}
