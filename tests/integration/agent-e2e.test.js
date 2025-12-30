import { jest } from '@jest/globals';
import request from 'supertest';
import { ProcessMonitor } from '../../src/ProcessMonitor.js';
import { PolicyEngine } from '../../src/PolicyEngine.js';
import { ApiServer } from '../../src/ApiServer.js';
import jwt from 'jsonwebtoken';
import * as platformModule from '../../src/platform/index.js';

// Mock platform module
jest.mock('../../src/platform/index.js');

describe('Agent E2E Integration', () => {
  let processMonitor;
  let policyEngine;
  let apiServer;
  let app;
  let mockPlatform;
  let authToken;

  const testPort = 8444;
  const testSecret = 'integration-test-secret';

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock platform
    mockPlatform = {
      getRunningProcesses: jest.fn().mockResolvedValue([]),
      killProcess: jest.fn().mockResolvedValue(true)
    };
    platformModule.getPlatform = jest.fn().mockReturnValue(mockPlatform);

    // Create real instances (not mocked)
    policyEngine = new PolicyEngine({ cacheDir: '/tmp/test-agent-e2e' });
    processMonitor = new ProcessMonitor(policyEngine);
    apiServer = new ApiServer(processMonitor, policyEngine, {
      port: testPort,
      jwtSecret: testSecret
    });

    app = apiServer.app;
    authToken = jwt.sign({ agentId: 'test-agent-e2e' }, testSecret);

    await apiServer.start();
  });

  afterEach(async () => {
    if (processMonitor.isRunning) {
      await processMonitor.stop();
    }
    if (apiServer.server) {
      await apiServer.stop();
    }
  });

  describe('Full lifecycle flow', () => {
    test('complete agent workflow: policy update → process detection → violation', async () => {
      // Step 1: Update policies via API
      const policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 1000 }
      ];

      const updateResponse = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ policies })
        .expect(200);

      expect(updateResponse.body.success).toBe(true);

      // Step 2: Verify policies were stored
      const getResponse = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(getResponse.body.policies).toEqual(policies);

      // Step 3: Mock running process
      mockPlatform.getRunningProcesses.mockResolvedValue([
        { name: 'Steam.exe', pid: 1234 }
      ]);

      // Step 4: Start monitoring
      await processMonitor.start();

      // Wait for initial check
      await new Promise(resolve => setTimeout(resolve, 100));

      // Step 5: Verify process was killed
      expect(mockPlatform.killProcess).toHaveBeenCalledWith('Steam.exe', 1234);

      // Step 6: Check violations via API
      const violationsResponse = await request(app)
        .get('/api/violations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(violationsResponse.body.violations.length).toBeGreaterThan(0);
      expect(violationsResponse.body.violations[0]).toMatchObject({
        processName: 'Steam.exe',
        pid: 1234,
        action: 'killed'
      });
    });

    test('policy sync from parent → local enforcement', async () => {
      // Mock parent API
      const mockParentPolicies = [
        { processName: 'Epic.exe', allowed: false, checkInterval: 2000 }
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ policies: mockParentPolicies })
      });

      // Step 1: Sync from parent
      const syncResponse = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ parentUrl: 'http://parent:8080' })
        .expect(200);

      expect(syncResponse.body.success).toBe(true);

      // Step 2: Verify policies were updated
      const policiesResponse = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(policiesResponse.body.policies).toEqual(mockParentPolicies);

      // Step 3: Mock running blocked process
      mockPlatform.getRunningProcesses.mockResolvedValue([
        { name: 'Epic.exe', pid: 5678 }
      ]);

      // Step 4: Trigger manual check
      await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Step 5: Verify enforcement
      expect(mockPlatform.killProcess).toHaveBeenCalledWith('Epic.exe', 5678);
    });

    test('multiple policy updates and enforcements', async () => {
      // Update 1: Block Steam
      await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          policies: [
            { processName: 'Steam.exe', allowed: false, checkInterval: 1000 }
          ]
        })
        .expect(200);

      mockPlatform.getRunningProcesses.mockResolvedValue([
        { name: 'Steam.exe', pid: 1111 }
      ]);

      await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockPlatform.killProcess).toHaveBeenCalledWith('Steam.exe', 1111);

      // Update 2: Block Epic, allow Steam
      await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          policies: [
            { processName: 'Steam.exe', allowed: true, checkInterval: 1000 },
            { processName: 'Epic.exe', allowed: false, checkInterval: 1000 }
          ]
        })
        .expect(200);

      mockPlatform.getRunningProcesses.mockResolvedValue([
        { name: 'Steam.exe', pid: 2222 },
        { name: 'Epic.exe', pid: 3333 }
      ]);

      mockPlatform.killProcess.mockClear();

      await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should only kill Epic, not Steam
      expect(mockPlatform.killProcess).not.toHaveBeenCalledWith('Steam.exe', 2222);
      expect(mockPlatform.killProcess).toHaveBeenCalledWith('Epic.exe', 3333);
    });

    test('violation history tracking', async () => {
      const policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 1000 }
      ];

      await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ policies })
        .expect(200);

      // Generate multiple violations
      for (let i = 0; i < 5; i++) {
        mockPlatform.getRunningProcesses.mockResolvedValue([
          { name: 'Steam.exe', pid: 1000 + i }
        ]);

        await request(app)
          .post('/api/check')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
      }

      // Check violations
      const violationsResponse = await request(app)
        .get('/api/violations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(violationsResponse.body.violations.length).toBe(5);

      // Check limited violations
      const limitedResponse = await request(app)
        .get('/api/violations?limit=3')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(limitedResponse.body.violations.length).toBe(3);
    });
  });

  describe('Error handling and recovery', () => {
    test('handles platform errors gracefully', async () => {
      const policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 1000 }
      ];

      await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ policies })
        .expect(200);

      // Mock platform error
      mockPlatform.getRunningProcesses.mockRejectedValue(new Error('Platform unavailable'));

      const checkResponse = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(checkResponse.body.error).toBeDefined();
    });

    test('continues monitoring after kill failure', async () => {
      const policies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 1000 }
      ];

      await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ policies })
        .expect(200);

      mockPlatform.getRunningProcesses.mockResolvedValue([
        { name: 'Steam.exe', pid: 1234 }
      ]);

      // First kill fails
      mockPlatform.killProcess.mockResolvedValueOnce(false);

      await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const violations = await request(app)
        .get('/api/violations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(violations.body.violations[0].action).toBe('kill_failed');

      // Second attempt succeeds
      mockPlatform.killProcess.mockResolvedValueOnce(true);

      await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      const newViolations = await request(app)
        .get('/api/violations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(newViolations.body.violations[0].action).toBe('killed');
    });
  });

  describe('Authentication flow', () => {
    test('requires authentication for all protected endpoints', async () => {
      const endpoints = [
        { method: 'get', path: '/api/policies' },
        { method: 'post', path: '/api/policies' },
        { method: 'get', path: '/api/violations' },
        { method: 'post', path: '/api/sync' },
        { method: 'post', path: '/api/check' }
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)[endpoint.method](endpoint.path);
        expect(response.status).toBe(401);
      }
    });

    test('accepts valid tokens', async () => {
      const response = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.policies).toBeDefined();
    });
  });
});
