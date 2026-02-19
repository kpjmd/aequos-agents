export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  moduleFileExtensions: ['js', 'json'],
  moduleNameMapper: {
    '^@coinbase/agentkit$': '<rootDir>/tests/__mocks__/@coinbase/agentkit.js',
    '^@coinbase/agentkit-langchain$': '<rootDir>/tests/__mocks__/@coinbase/agentkit-langchain.js',
    '^@coinbase/cdp-sdk(.*)$': '<rootDir>/tests/__mocks__/@coinbase/cdp-sdk.js',
  },
  transform: {},
  testTimeout: 30000,
  verbose: true
};