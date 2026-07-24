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
};