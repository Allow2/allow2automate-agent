import { describe, it, expect, jest } from '@jest/globals';
import { exec } from 'child_process';

// Mock child_process
jest.mock('child_process');

// Import after mocking
import darwin from '../../src/platform/darwin.js';

describe('macOS Platform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isProcessRunning', () => {
    it('should return true if process is running', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '1234\n5678\n' });
      });

      const running = await darwin.isProcessRunning('Chrome');
      expect(running).toBe(true);
    });

    it('should return false if process is not running', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('No matching processes'), { stdout: '' });
      });

      const running = await darwin.isProcessRunning('NotRunning');
      expect(running).toBe(false);
    });
  });

  describe('killProcess', () => {
    it('should kill process successfully', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '' });
      });

      const result = await darwin.killProcess('Chrome');
      expect(result).toBe(true);
    });

    it('should throw error on failure', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('Permission denied'));
      });

      await expect(darwin.killProcess('System')).rejects.toThrow();
    });
  });

  describe('getProcessList', () => {
    it('should parse process list correctly', async () => {
      const psOutput = `  PID COMMAND         USER      %CPU %MEM
 1234 /Applications/Chrome user      5.0  2.5
 5678 /usr/bin/node   user      3.0  1.5`;

      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: psOutput });
      });

      const processes = await darwin.getProcessList();

      expect(processes).toHaveLength(2);
      expect(processes[0].pid).toBe(1234);
      expect(processes[0].name).toBe('/Applications/Chrome');
      expect(processes[1].pid).toBe(5678);
    });

    it('should handle empty process list', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'PID COMMAND USER %CPU %MEM\n' });
      });

      const processes = await darwin.getProcessList();
      expect(processes).toEqual([]);
    });
  });
});
