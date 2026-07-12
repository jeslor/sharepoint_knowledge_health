// @ts-check
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

export default tseslint.config(...rootConfig, {
  rules: {
    // Pure business logic, no infrastructure — mirrors packages/graph-client's
    // boundary rule for the same reason: independently testable, and the
    // worker (not this package) decides how results get persisted.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@prisma/client', '@prisma/client/*'], message: 'packages/scoring must never depend on Prisma.' },
          { group: ['@sph/database', '@sph/database/*'], message: 'packages/scoring must never depend on the database layer.' },
          { group: ['bullmq', 'bullmq/*'], message: 'packages/scoring must never know about the job queue.' },
        ],
      },
    ],
  },
});
