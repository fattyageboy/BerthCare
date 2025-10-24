/* eslint-disable */
export default {
  displayName: 'shared',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/shared',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.spec.ts', '!examples/**'],
  coverageThreshold: {
    global: {
      branches: 65,
      functions: 55,
      lines: 90,
      statements: 90,
    },
  },
};
