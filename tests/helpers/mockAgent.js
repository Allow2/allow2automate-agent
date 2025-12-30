/**
 * Mock agent utilities for testing
 */

export function createMockAgent(overrides = {}) {
  return {
    id: 'test-agent-id',
    hostname: 'test-pc',
    platform: 'win32',
    online: true,
    lastSeen: new Date(),
    version: '1.0.0',
    ipAddresses: ['192.168.1.100'],
    ...overrides
  };
}

export function createMockAgentList(count = 3) {
  const agents = [];
  for (let i = 0; i < count; i++) {
    agents.push(createMockAgent({
      id: `agent-${i}`,
      hostname: `pc-${i}`,
      ipAddresses: [`192.168.1.${100 + i}`]
    }));
  }
  return agents;
}

export function createMockProcessMonitor(overrides = {}) {
  return {
    isRunning: false,
    violations: [],
    start: jest.fn().mockResolvedValue(),
    stop: jest.fn().mockResolvedValue(),
    checkProcesses: jest.fn().mockResolvedValue(),
    getViolations: jest.fn((limit) => {
      const violations = overrides.violations || [];
      return limit ? violations.slice(0, limit) : violations;
    }),
    ...overrides
  };
}

export function createMockPolicyEngine(overrides = {}) {
  const defaultPolicies = [
    { processName: 'Steam.exe', allowed: false, checkInterval: 30000 },
    { processName: 'chrome.exe', allowed: true, checkInterval: 60000 }
  ];

  return {
    policies: overrides.policies || defaultPolicies,
    getProcessPolicies: jest.fn(function() {
      return this.policies;
    }),
    isProcessAllowed: jest.fn((name) => {
      const policy = defaultPolicies.find(p =>
        p.processName.toLowerCase() === name.toLowerCase()
      );
      return policy ? policy.allowed : true;
    }),
    updatePolicies: jest.fn(async function(policies) {
      this.policies = policies;
    }),
    syncFromParent: jest.fn().mockResolvedValue(true),
    getPolicy: jest.fn((name) => {
      return defaultPolicies.find(p => p.processName === name);
    }),
    removePolicy: jest.fn().mockResolvedValue(),
    on: jest.fn(),
    emit: jest.fn(),
    ...overrides
  };
}

export function createMockViolation(overrides = {}) {
  return {
    processName: 'Steam.exe',
    pid: 1234,
    timestamp: new Date(),
    action: 'killed',
    ...overrides
  };
}

export function createMockViolationList(count = 5) {
  const violations = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    violations.push(createMockViolation({
      pid: 1000 + i,
      timestamp: new Date(now - i * 60000) // 1 minute apart
    }));
  }

  return violations;
}
