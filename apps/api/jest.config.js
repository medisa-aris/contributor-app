/** @type {import('jest').Config} */
const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@contributor/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
};

module.exports = {
  maxWorkers: 1,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/integration/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/integration/helpers/setup-env.ts'],
      globalSetup: '<rootDir>/test/integration/helpers/global-setup.ts',
      testTimeout: 30000,
    },
  ],
};
