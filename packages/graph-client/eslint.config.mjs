// @ts-check
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

export default tseslint.config(...rootConfig, {
  rules: {
    // ADR-0013 §9: this module must never depend on our infrastructure —
    // it must be describable as a standalone, product-agnostic Graph SDK.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@prisma/client', '@prisma/client/*'], message: 'packages/graph-client must never depend on Prisma.' },
          { group: ['@sph/database', '@sph/database/*'], message: 'packages/graph-client must never depend on the database layer.' },
          { group: ['bullmq', 'bullmq/*'], message: 'packages/graph-client must never know about the job queue.' },
        ],
      },
    ],
  },
});
