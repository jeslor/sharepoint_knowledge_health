import type { TenantContext, User } from '@sph/database';

/**
 * Only tid/oid are trusted for identity resolution (ADR-0011). email/name
 * are carried through purely for display/profile-sync purposes on
 * first provisioning — never used in a lookup or authorization decision.
 */
export interface EntraClaims {
  tid: string;
  oid: string;
  email?: string;
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      entraClaims?: EntraClaims;
      user?: User;
      tenantContext?: TenantContext;
      // Phase 9: set by request-logger.middleware.ts, before any guard runs.
      requestId?: string;
    }
  }
}
