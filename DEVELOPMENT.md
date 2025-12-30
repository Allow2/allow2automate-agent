# Development Guide - Allow2 Automate Agent

## Project Structure

```
allow2automate-agent/
├── src/                      # Source code
│   ├── index.js             # Main entry point
│   ├── ApiServer.js         # REST API server
│   ├── ProcessMonitor.js    # Process monitoring
│   ├── PolicyEngine.js      # Policy management
│   ├── ConfigManager.js     # Configuration
│   ├── DiscoveryAdvertiser.js # mDNS
│   ├── AutoUpdater.js       # Auto-update
│   ├── Logger.js            # Logging
│   └── platform/            # Platform implementations
│       ├── windows.js
│       ├── darwin.js
│       └── linux.js
├── tests/                   # Tests
│   ├── ConfigManager.test.js
│   ├── PolicyEngine.test.js
│   ├── ProcessMonitor.test.js
│   └── platform/
│       ├── windows.test.js
│       └── darwin.test.js
├── config/                  # Configuration
│   └── default.json
├── installers/              # Platform installers
│   ├── windows/
│   ├── macos/
│   └── linux/
└── scripts/                 # Utility scripts
```

## Development Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd allow2automate-agent
npm install
```

### 2. Run in Development Mode

```bash
npm run start:dev
```

This runs with:
- `NODE_ENV=development`
- Verbose logging
- Auto-restart on code changes (if using nodemon)

### 3. Run Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage

# Specific test file
npm test -- tests/PolicyEngine.test.js
```

## Code Style

### ESLint

```bash
npm run lint
```

### Style Guide

- Use ES modules (`import`/`export`)
- 2-space indentation
- Single quotes for strings
- Semicolons required
- Max line length: 100 characters
- Async/await preferred over promises
- Descriptive variable names
- JSDoc comments for public methods

### Example

```javascript
/**
 * Create a new policy
 * @param {Object} policy - Policy configuration
 * @returns {Promise<Object>} Created policy
 */
async createPolicy(policy) {
  if (!policy.id || !policy.processName) {
    throw new Error('Policy must have id and processName');
  }

  const newPolicy = {
    id: policy.id,
    processName: policy.processName,
    allowed: policy.allowed !== undefined ? policy.allowed : true,
    createdAt: new Date().toISOString()
  };

  this.policies.set(newPolicy.id, newPolicy);
  await this.saveToCache();

  return newPolicy;
}
```

## Testing

### Unit Tests

Test individual modules in isolation:

```javascript
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import PolicyEngine from '../src/PolicyEngine.js';

describe('PolicyEngine', () => {
  let policyEngine;
  let mockConfigManager;

  beforeEach(() => {
    mockConfigManager = {
      get: jest.fn(),
      set: jest.fn()
    };
    policyEngine = new PolicyEngine(mockConfigManager, mockLogger);
  });

  it('should create a new policy', async () => {
    const policy = await policyEngine.createPolicy({
      id: 'p1',
      processName: 'app.exe'
    });
    expect(policy.id).toBe('p1');
  });
});
```

### Integration Tests

Test multiple modules together (future):

```javascript
describe('Agent E2E', () => {
  it('should monitor and enforce policies', async () => {
    // Start agent
    // Create policy
    // Start prohibited process
    // Verify process is killed
  });
});
```

### Platform-Specific Tests

Test platform implementations with mocked `exec`:

```javascript
import { exec } from 'child_process';
jest.mock('child_process');

it('should detect running process', async () => {
  exec.mockImplementation((cmd, callback) => {
    callback(null, { stdout: 'chrome.exe 1234' });
  });
  
  const running = await windows.isProcessRunning('chrome.exe');
  expect(running).toBe(true);
});
```

## Debugging

### VS Code Launch Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Agent",
      "program": "${workspaceFolder}/src/index.js",
      "env": {
        "NODE_ENV": "development"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "program": "${workspaceFolder}/node_modules/jest/bin/jest.js",
      "args": ["--runInBand"],
      "console": "integratedTerminal"
    }
  ]
}
```

### Debug Logging

Enable verbose logging:

```javascript
// In code
this.logger.setLevel('debug');

// Or via config
{
  "logLevel": "debug"
}
```

### Testing API Endpoints

Use curl or a REST client:

```bash
# Health check
curl -v http://localhost:8443/api/health

# Create policy (needs auth)
curl -X POST http://localhost:8443/api/policies \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{"id":"p1","processName":"app.exe","allowed":false}'
```

## Adding Features

### 1. Add New Platform Support

Create new file in `src/platform/`:

```javascript
// src/platform/freebsd.js
export default {
  async isProcessRunning(processName) {
    // Implementation
  },
  async killProcess(processName) {
    // Implementation
  },
  async getProcessList() {
    // Implementation
  }
};
```

Update `src/index.js` to load the new platform.

### 2. Add New API Endpoint

In `src/ApiServer.js`:

```javascript
this.app.get('/api/new-endpoint', async (req, res) => {
  try {
    // Implementation
    res.json({ result: 'data' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### 3. Add New Policy Feature

In `src/PolicyEngine.js`:

```javascript
async checkNewFeature(policy) {
  // Implementation
}
```

Update tests and documentation.

## Performance Optimization

### Reduce Check Interval

For development, use shorter interval:

```json
{
  "checkInterval": 5000
}
```

For production, use longer interval:

```json
{
  "checkInterval": 30000
}
```

### Optimize Process List Parsing

Cache process list results:

```javascript
this.processListCache = null;
this.cacheExpiry = 0;

async getProcessList() {
  const now = Date.now();
  if (this.processListCache && now < this.cacheExpiry) {
    return this.processListCache;
  }
  
  this.processListCache = await this.platform.getProcessList();
  this.cacheExpiry = now + 5000; // 5 second cache
  return this.processListCache;
}
```

## CI/CD

### GitHub Actions (example)

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [18, 20]
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node }}
      - run: npm install
      - run: npm test
      - run: npm run lint
```

## Release Process

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Run tests: `npm test`
4. Build installers:
   - `npm run build:windows`
   - `npm run build:macos`
   - `npm run build:linux`
5. Create git tag: `git tag v1.0.0`
6. Push: `git push --tags`
7. Create GitHub release with installers

## Common Issues

### Port Already in Use

Change port in config or use environment variable:

```bash
ALLOW2_API_PORT=9000 npm start
```

### Permission Denied

Agent needs elevated privileges:

```bash
sudo npm start
```

### Module Not Found

Ensure using ES modules:

```json
{
  "type": "module"
}
```

Use `.js` extensions in imports:

```javascript
import PolicyEngine from './PolicyEngine.js';
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes
4. Add tests
5. Run linter: `npm run lint`
6. Run tests: `npm test`
7. Commit: `git commit -m "feat: description"`
8. Push: `git push origin feature-name`
9. Create Pull Request

### Commit Convention

Use conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `test:` Tests
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `chore:` Maintenance

## Resources

- [Node.js Documentation](https://nodejs.org/docs)
- [Express.js Guide](https://expressjs.com/guide)
- [Jest Documentation](https://jestjs.io/docs)
- [Winston Logger](https://github.com/winstonjs/winston)
