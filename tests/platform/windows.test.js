import { describe, it, expect, jest } from '@jest/globals';
import { exec } from 'child_process';

// Mock child_process
jest.mock('child_process');

// Import after mocking
import windows from '../../src/platform/windows.js';

describe('Windows Platform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isProcessRunning', () => {
    it('should return true if process is running', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'chrome.exe                    1234' });
      });

      const running = await windows.isProcessRunning('chrome.exe');
      expect(running).toBe(true);
    });

    it('should return false if process is not running', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('Not found'), { stdout: '' });
      });

      const running = await windows.isProcessRunning('notepad.exe');
      expect(running).toBe(false);
    });

    it('should add .exe extension if missing', async () => {
      exec.mockImplementation((cmd, callback) => {
        expect(cmd).toContain('chrome.exe');
        callback(null, { stdout: 'chrome.exe                    1234' });
      });

      await windows.isProcessRunning('chrome');
    });
  });

  describe('killProcess', () => {
    it('should kill process successfully', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'SUCCESS' });
      });

      const result = await windows.killProcess('chrome.exe');
      expect(result).toBe(true);
    });

    it('should throw error on failure', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('Access denied'));
      });

      await expect(windows.killProcess('system.exe')).rejects.toThrow();
    });
  });

  describe('getProcessList', () => {
    it('should parse process list correctly', async () => {
      const tasklistOutput = `"chrome.exe","1234","Console","123,456 K"
"notepad.exe","5678","Console","12,345 K"`;

      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: tasklistOutput });
      });

      const processes = await windows.getProcessList();

      expect(processes).toHaveLength(2);
      expect(processes[0].name).toBe('chrome.exe');
      expect(processes[0].pid).toBe(1234);
      expect(processes[1].name).toBe('notepad.exe');
      expect(processes[1].pid).toBe(5678);
    });

    it('should handle empty process list', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: '' });
      });

      const processes = await windows.getProcessList();
      expect(processes).toEqual([]);
    });
  });
});
