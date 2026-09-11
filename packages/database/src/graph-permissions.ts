/**
 * ADR-0023 §3.2: the one place this application declares which Microsoft
 * Graph permissions it currently expects. The Azure app registration
 * manifest remains Microsoft's actual grant record — this constant
 * describes what *this application* requires, and is compared against a
 * given MicrosoftTenant's own recorded verification/assertion state
 * (permission-state.ts). Read and write requirements are kept in separate
 * lists deliberately: read scopes are independently, cheaply verifiable
 * (GraphConsentVerifierService's real listSites() call); write scopes are
 * not, without either requesting Directory.Read.All/Application.Read.All
 * (rejected, ADR-0012's amendment) or a synthetic write probe (rejected,
 * ADR-0023 §3.3) — see ADR-0023 for the full reasoning. This asymmetry is
 * exactly why permission state (permission-state.ts) is tracked as two
 * fields, not one.
 *
 * Not persisted anywhere — this is application configuration, not tenant
 * state. Do not duplicate these values elsewhere; import from here.
 */
export const REQUIRED_GRAPH_PERMISSIONS = {
  read: ['Files.Read.All', 'Sites.Read.All'],
  write: ['Sites.ReadWrite.All'],
} as const;

/**
 * Bump this whenever REQUIRED_GRAPH_PERMISSIONS changes materially (a scope
 * added or removed). Comparing a MicrosoftTenant's own recorded
 * verifiedReadPermissionVersion/consentAssertedPermissionVersion against
 * this single number is what derivePermissionReconsentState uses to decide
 * whether a tenant is behind (ADR-0023 §3.4) — no separate read/write
 * version constants; the asymmetry lives entirely in which tenant-side
 * field is trusted for which claim, not in the requirement version itself.
 *
 * Version history:
 *  - v1: Files.Read.All + Sites.Read.All (read-only MVP, ADR-0003).
 *  - v2 (ADR-0003 amendment / ADR-0016 / ADR-0022 write-back MVP): adds
 *    Sites.ReadWrite.All for review-date write-back. Every tenant that only
 *    completed the v1 admin-consent redirect now correctly resolves as
 *    behind (needsWriteConsentAssertion → needsReconsent) until an admin
 *    re-consents to the enlarged set — which is exactly what gates the
 *    write-back remediation feature from running against a tenant that has
 *    not granted the write scope.
 */
export const REQUIRED_PERMISSION_VERSION = 2;
