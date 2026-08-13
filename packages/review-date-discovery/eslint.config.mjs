// @ts-check
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

export default tseslint.config(...rootConfig, {
  rules: {
    // Pure business logic, no infrastructure — mirrors packages/scoring's
    // and packages/graph-client's own boundary rules for the same reason:
    // this package must be importable identically by a NestJS HTTP service
    // (apps/api) and a BullMQ worker (apps/worker), so it can never take on
    // a dependency only one of those two runtimes has.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@prisma/client', '@prisma/client/*'], message: 'packages/review-date-discovery must never depend on Prisma.' },
          { group: ['@sph/database', '@sph/database/*'], message: 'packages/review-date-discovery must never depend on the database layer.' },
          { group: ['bullmq', 'bullmq/*'], message: 'packages/review-date-discovery must never know about the job queue.' },
          { group: ['@nestjs/*'], message: 'packages/review-date-discovery must never depend on a specific app framework.' },
        ],
      },
    ],
  },
});
