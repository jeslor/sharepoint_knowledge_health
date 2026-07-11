import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // Integration tests share a single real Postgres database — run serially
  // to avoid cross-test interference (also set via --runInBand in the
  // package.json script, kept here too for anyone invoking jest directly).
  maxWorkers: 1,
};

export default config;
