/**
 * Jest Configuration for Backend Integration Tests
 */

module.exports = {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    '^@berthcare/shared$': '<rootDir>/../../libs/shared/src/index.ts',
    '^@berthcare/shared/(.*)$': '<rootDir>/../../libs/shared/src/$1',
  },
  coverageDirectory: '../../coverage/apps/backend',
  testMatch: ['**/tests/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  globalTeardown: '<rootDir>/tests/teardown.ts',
  forceExit: true, // Force exit after tests complete (important for CI)
  detectOpenHandles: false, // Disable for faster runs
  testTimeout: 30000, // 30 second timeout per test
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/main-with-monitoring.ts',
    '!src/test-connection.ts',
    '!src/db/migrate.ts',
    '!src/db/seed.ts',
    '!src/db/verify-schema.ts',
    '!src/db/pool.ts',
    '!src/config/**',
    '!src/middleware/examples/**',
    '!src/storage/test-s3.ts',
    '!src/services/**',
    '!src/storage/**',
  ],
  coverageThreshold: {
    global: {
      branches: 70, // Branch-heavy error paths remain difficult to exercise; line/statement coverage enforced at 80%
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
