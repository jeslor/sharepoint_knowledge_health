/**
 * Priority 4 (security hardening): the contract resolveOrProvisionFromConsent
 * depends on to confirm a brand-new tenant's admin actually granted this
 * app's required Microsoft Graph permissions, before bootstrapping an
 * Organization for it. Deliberately Graph-agnostic — this package must
 * never import @sph/graph-client (the same package-boundary rule ADR-0013
 * already established: no package imports another package). The real,
 * Graph-aware implementation lives entirely in apps/api and is injected in.
 */
export interface ConsentVerifier {
  /**
   * Resolves when the tenant has genuinely granted this app's required
   * permissions. Throws otherwise:
   *
   * - Throws ConsentVerificationError when verification definitively
   *   failed (the tenant hasn't granted consent) — resolveOrProvisionFromConsent
   *   treats this, and only this, as a rejected bootstrap attempt.
   * - Throws anything else (a Graph outage, throttling, an unexpected
   *   error) to signal an infrastructure failure, not a consent decision —
   *   resolveOrProvisionFromConsent lets this propagate untouched rather
   *   than silently treating "Microsoft was unreachable" as "consent is
   *   missing".
   */
  verifyTenantConsent(entraTenantId: string): Promise<void>;
}

/**
 * Thrown by a ConsentVerifier implementation to signal that verification
 * definitively failed — never thrown by this package itself. A real
 * implementation (apps/api's GraphConsentVerifierService) is responsible
 * for mapping its own Graph-specific errors (GraphPermissionError /
 * GraphAuthenticationError) into this domain error; every other error type
 * it might encounter must be left to propagate as-is, not converted to this.
 */
export class ConsentVerificationError extends Error {}
