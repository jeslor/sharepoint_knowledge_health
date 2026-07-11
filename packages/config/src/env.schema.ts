import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // ADR-0011/Phase 4: our Entra ID app registration's client ID, validated
  // as the `aud` claim on every incoming JWT.
  ENTRA_CLIENT_ID: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
