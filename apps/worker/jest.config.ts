import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // .ts only — apps/worker has no plain-JS source of its own, and matching
  // .js here would make ts-jest try to "compile" packages/database's
  // already-compiled dist/ output when it's pulled into the module graph.
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // app.module.spec.ts boots a real BullMQ Worker against Redis. worker.close()
  // is correctly invoked via Nest's onApplicationShutdown (confirmed in
  // @nestjs/bullmq's BullExplorer), but ioredis leaves internal
  // reconnect/keepalive timers open well past Jest's 1s open-handle window —
  // a well-known upstream BullMQ+Jest interaction, not a leak in this code.
  forceExit: true,
};

export default config;
