// @ts-check
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import rootConfig from '../../eslint.config.mjs';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default tseslint.config(
  { ignores: ['next-env.d.ts'] },
  ...rootConfig,
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // apps/web must never touch the database, queue, or Graph directly —
      // it only talks to apps/api over REST (ADR-0009).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@sph/database', '@sph/database/*'], message: 'apps/web must not access the database directly — call apps/api over REST instead.' },
          ],
        },
      ],
    },
  },
);
