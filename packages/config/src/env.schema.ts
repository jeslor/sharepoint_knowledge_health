import { z, ZodError } from 'zod';

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
  // Phase 6 (trial upgrade UX): apps/api's EmailService, used only by the
  // "Request an upgrade" flow (POST /organizations/:id/upgrade-request) —
  // a Resend API key + verified sender address. Deliberately optional: no
  // other part of the application depends on email, so a deployment
  // without these configured must still boot normally (validateEnvOrExit
  // must not fail the whole API over an unconfigured secondary feature).
  // EmailService itself fails closed at call time when either is missing —
  // see its own module comment.
  EMAIL_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

/**
 * Phase 9 (production hardening): call this first thing in every app's
 * bootstrap. Missing/invalid required config previously surfaced late and
 * cryptically — e.g. Prisma throwing deep in a request handler, or Entra
 * JWT validation failing with no clue why — instead of failing immediately
 * at startup with a clear, actionable message. Exits the process rather
 * than throwing, since an uncaught exception at this point would otherwise
 * print a raw Zod stack trace with no indication of which variable is
 * actually the problem.
 */
export function validateEnvOrExit(source: NodeJS.ProcessEnv = process.env): Env {
  try {
    return envSchema.parse(source);
  } catch (error) {
    console.error(`Invalid environment configuration:\n${formatEnvError(error)}`);
    process.exit(1);
  }
}

function formatEnvError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}
