import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // .ts only — apps/api has no plain-JS source of its own, and matching
  // .js here would make ts-jest try to "compile" packages/database's
  // already-compiled dist/ output when it's pulled into the module graph.
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // ScansModule wires a real BullMQ queue against Redis. Any test that
  // boots the full AppModule leaves ioredis's internal reconnect/keepalive
  // timers open past Jest's 1s handle-detection window — same well-known
  // upstream BullMQ+Jest interaction as apps/worker, not a leak here.
  forceExit: true,
};

export default config;
