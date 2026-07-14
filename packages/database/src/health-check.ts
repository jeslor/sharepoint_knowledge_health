import { prisma } from './client';

/**
 * Phase 9 (production hardening) — a sanctioned, deliberately unscoped
 * connectivity probe, in the same spirit as identity.ts's
 * findUserByEntraIdentity: it exists specifically because organizationId
 * doesn't apply here (this checks "can we reach Postgres at all," not any
 * tenant's data). Used only by apps/api's readiness endpoint. Returns a
 * boolean rather than throwing so the caller can build a composite
 * readiness response without a try/catch of its own.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
