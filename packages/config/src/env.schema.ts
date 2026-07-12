import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // ADR-0011/Phase 4: our Entra ID app registration's client ID, validated
  // as the `aud` claim on every incoming JWT.
  ENTRA_CLIENT_ID: z.string().min(1),
  // ADR-0013/Phase 5: used by packages/graph-client's MSAL client-credentials
  // flow to acquire app-only Graph tokens. Key Vault-backed in production
  // per ADR-0006.
  ENTRA_CLIENT_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
