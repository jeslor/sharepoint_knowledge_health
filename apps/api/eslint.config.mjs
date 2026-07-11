// @ts-check
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

export default tseslint.config(...rootConfig, {
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // apps/api must go through @sph/database's tenant-scoped repositories —
    // it must never construct a Prisma query directly (ADR-0001, Phase 3).
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@prisma/client', '@prisma/client/*'],
            message: 'Import from @sph/database instead — apps must not construct Prisma queries directly.',
          },
        ],
      },
    ],
  },
});
