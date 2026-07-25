/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // Register shared test lifecycle hooks.
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // Allow refill/window-expiry tests to complete.
  testTimeout: 30000,

  verbose: true,

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    // server.ts is an entry-point and cannot be unit-tested without spawning a process
    '!src/server.ts',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      functions: 80,
      lines: 80,
      branches: 75,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
};