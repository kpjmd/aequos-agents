// Jest setup file for OrthoIQ Agents tests
import { jest, beforeAll, afterEach } from '@jest/globals';

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.ENABLE_BLOCKCHAIN = 'false';
process.env.MOCK_BLOCKCHAIN_RESPONSES = 'true';
process.env.CDP_API_KEY_NAME = 'test_key';
process.env.CDP_API_KEY_PRIVATE_KEY = '0x' + '1'.repeat(64);
process.env.CLAUDE_API_KEY = 'test_claude_key';

// Increase Jest timeout for async operations
jest.setTimeout(30000);

// Global test setup
beforeAll(() => {
  // Suppress console logs during tests unless LOG_LEVEL is debug
  if (process.env.LOG_LEVEL !== 'debug') {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});