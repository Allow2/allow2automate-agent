import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { ApiServer } from '../../src/ApiServer.js';
import jwt from 'jsonwebtoken';

// Mock dependencies
jest.mock('../../src/ProcessMonitor.js');
jest.mock('../../src/PolicyEngine.js');

describe('ApiServer', () => {
  let apiServer;
  let app;
  let mockProcessMonitor;
  let mockPolicyEngine;
  const testPort = 8443;
  const testSecret = 'test-secret-key';

  beforeEach(() => {
    // Mock ProcessMonitor
    mockProcessMonitor = {
      getViolations: jest.fn().mockReturnValue([
        {
          processName: 'Steam.exe',
          pid: 1234,
          timestamp: new Date(),
          action: 'killed'
        }
      ]),
      checkProcesses: jest.fn().mockResolvedValue(),
      start: jest.fn().mockResolvedValue(),
      stop: jest.fn().mockResolvedValue()
    };

    // Mock PolicyEngine
    mockPolicyEngine = {
      getProcessPolicies: jest.fn().mockReturnValue([
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 }
      ]),
      updatePolicies: jest.fn().mockResolvedValue(),
      syncFromParent: jest.fn().mockResolvedValue(true),
      getPolicy: jest.fn(),
      removePolicy: jest.fn().mockResolvedValue()
    };

    apiServer = new ApiServer(mockProcessMonitor, mockPolicyEngine, {
      port: testPort,
      jwtSecret: testSecret
    });
    app = apiServer.app;
  });

  afterEach(async () => {
    if (apiServer.server) {
      await apiServer.stop();
    }
  });

  describe('constructor', () => {
    test('initializes Express app', () => {
      expect(app).toBeDefined();
      expect(typeof app).toBe('function');
    });

    test('sets up middleware', () => {
      expect(app._router).toBeDefined();
    });
  });

  describe('authentication', () => {
    test('rejects requests without token', async () => {
      const response = await request(app)
        .get('/api/policies')
        .expect(401);

      expect(response.body.error).toMatch(/token/i);
    });

    test('rejects requests with invalid token', async () => {
      const response = await request(app)
        .get('/api/policies')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toMatch(/invalid|token/i);
    });

    test('accepts requests with valid token', async () => {
      const token = jwt.sign({ agentId: 'test-agent' }, testSecret);

      const response = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.policies).toBeDefined();
    });

    test('accepts token in query parameter', async () => {
      const token = jwt.sign({ agentId: 'test-agent' }, testSecret);

      const response = await request(app)
        .get(`/api/policies?token=${token}`)
        .expect(200);

      expect(response.body.policies).toBeDefined();
    });
  });

  describe('GET /health', () => {
    test('returns health status without authentication', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /api/policies', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('returns all policies', async () => {
      const response = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.policies).toEqual(mockPolicyEngine.getProcessPolicies());
    });

    test('returns empty array when no policies exist', async () => {
      mockPolicyEngine.getProcessPolicies.mockReturnValue([]);

      const response = await request(app)
        .get('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.policies).toEqual([]);
    });
  });

  describe('POST /api/policies', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('updates policies', async () => {
      const newPolicies = [
        { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
        { processName: 'Epic.exe', allowed: false, checkInterval: 30000 }
      ];

      const response = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ policies: newPolicies })
        .expect(200);

      expect(mockPolicyEngine.updatePolicies).toHaveBeenCalledWith(newPolicies);
      expect(response.body.success).toBe(true);
    });

    test('validates request body', async () => {
      const response = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({}) // Missing policies field
        .expect(400);

      expect(response.body.error).toMatch(/policies/i);
    });

    test('validates policies array', async () => {
      const response = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ policies: 'not-an-array' })
        .expect(400);

      expect(response.body.error).toMatch(/array/i);
    });

    test('handles update errors', async () => {
      mockPolicyEngine.updatePolicies.mockRejectedValue(new Error('Update failed'));

      const response = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .send({ policies: [] })
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/violations', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('returns violations', async () => {
      const response = await request(app)
        .get('/api/violations')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.violations).toEqual(mockProcessMonitor.getViolations());
    });

    test('supports limit parameter', async () => {
      const response = await request(app)
        .get('/api/violations?limit=5')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(mockProcessMonitor.getViolations).toHaveBeenCalledWith(5);
    });

    test('validates limit parameter', async () => {
      const response = await request(app)
        .get('/api/violations?limit=invalid')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.error).toMatch(/limit/i);
    });
  });

  describe('POST /api/sync', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('syncs policies from parent', async () => {
      const response = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ parentUrl: 'http://parent:8080' })
        .expect(200);

      expect(mockPolicyEngine.syncFromParent).toHaveBeenCalledWith('http://parent:8080');
      expect(response.body.success).toBe(true);
    });

    test('validates parent URL', async () => {
      const response = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${token}`)
        .send({}) // Missing parentUrl
        .expect(400);

      expect(response.body.error).toMatch(/url/i);
    });

    test('handles sync failure', async () => {
      mockPolicyEngine.syncFromParent.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/sync')
        .set('Authorization', `Bearer ${token}`)
        .send({ parentUrl: 'http://parent:8080' })
        .expect(500);

      expect(response.body.error).toMatch(/sync.*failed/i);
    });
  });

  describe('POST /api/check', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('triggers process check', async () => {
      const response = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(mockProcessMonitor.checkProcesses).toHaveBeenCalled();
      expect(response.body.success).toBe(true);
    });

    test('handles check errors', async () => {
      mockProcessMonitor.checkProcesses.mockRejectedValue(new Error('Check failed'));

      const response = await request(app)
        .post('/api/check')
        .set('Authorization', `Bearer ${token}`)
        .expect(500);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('server lifecycle', () => {
    test('starts server on specified port', async () => {
      await apiServer.start();

      expect(apiServer.server).toBeDefined();
      expect(apiServer.server.listening).toBe(true);
    });

    test('stops server gracefully', async () => {
      await apiServer.start();
      await apiServer.stop();

      expect(apiServer.server.listening).toBe(false);
    });

    test('handles port already in use', async () => {
      // Start first server
      await apiServer.start();

      // Try to start another on same port
      const apiServer2 = new ApiServer(mockProcessMonitor, mockPolicyEngine, {
        port: testPort,
        jwtSecret: testSecret
      });

      await expect(apiServer2.start()).rejects.toThrow();
    });
  });

  describe('error handling', () => {
    let token;

    beforeEach(() => {
      token = jwt.sign({ agentId: 'test-agent' }, testSecret);
    });

    test('handles malformed JSON', async () => {
      const response = await request(app)
        .post('/api/policies')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    test('handles 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/api/unknown')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.body.error).toMatch(/not found/i);
    });
  });
});
