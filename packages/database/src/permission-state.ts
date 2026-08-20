import type { MicrosoftTenant } from '@prisma/client';
import { prisma } from './client';
import { REQUIRED_PERMISSION_VERSION } from './graph-permissions';

export interface PermissionReconsentState {
  /** Real, Graph-verified signal — GraphConsentVerifierService has not
   * confirmed the read scopes work as of the current required version. */
  needsReadReconsent: boolean;
  /** Optimistic, UX-only signal — the admin has not completed a consent
   * redirect for the current required version. Never a security control;
   * never proof the write scope is missing OR present. */
  needsWriteConsentAssertion: boolean;
  /** Combined, for simple banner-rendering. Consumers that need to reason
   * about "how sure are we" should use the two fields above instead. */
  needsReconsent: boolean;
}

/**
 * ADR-0023 §3.4: derived at read time, never persisted, and never a new
 * MicrosoftTenantStatus value — status answers "is the connection alive,"
 * this answers an orthogonal question ("does the granted set satisfy what
 * we currently require"), and a tenant can be Consented and behind at the
 * same time. Only meaningful for a Consented tenant — PendingConsent/Revoked
 * always resolve false here, since completing consent today grants
 * whatever the manifest currently declares (no separate tracking needed).
 */
export function derivePermissionReconsentState(
  tenant: Pick<MicrosoftTenant, 'status' | 'verifiedReadPermissionVersion' | 'consentAssertedPermissionVersion'>,
  // Defaults to the real application constant — overridable only so tests
  // can simulate a future required-version bump without needing a second
  // live tenant fixture at a different version.
  requiredVersion: number = REQUIRED_PERMISSION_VERSION,
): PermissionReconsentState {
  if (tenant.status !== 'Consented') {
    return { needsReadReconsent: false, needsWriteConsentAssertion: false, needsReconsent: false };
  }

  const needsReadReconsent = (tenant.verifiedReadPermissionVersion ?? 0) < requiredVersion;
  const needsWriteConsentAssertion = (tenant.consentAssertedPermissionVersion ?? 0) < requiredVersion;

  return {
    needsReadReconsent,
    needsWriteConsentAssertion,
    needsReconsent: needsReadReconsent || needsWriteConsentAssertion,
  };
}

/**
 * ADR-0023 §3.3/§3.5: advanced ONLY by a caller that just made a real,
 * passing GraphConsentVerifierService check — never inferred from an OAuth
 * redirect succeeding, and never called by a passive/background check with
 * anything other than a genuinely-observed pass. Conditioned in the same
 * query (not a separate read-then-write) so a concurrent call can never
 * regress a higher version, and so the caller can tell, from `advanced`
 * alone, whether this call actually changed anything (used to avoid
 * duplicate audit events and to avoid re-verifying work already reflected).
 * A failed/inconclusive verification must never call this at all — leaving
 * the stored value untouched is the caller's responsibility (ADR-0023 §3.6).
 */
export async function applyVerifiedReadPermission(
  microsoftTenantId: string,
  version: number,
): Promise<{ advanced: boolean }> {
  const result = await prisma.microsoftTenant.updateMany({
    where: {
      id: microsoftTenantId,
      OR: [{ verifiedReadPermissionVersion: null }, { verifiedReadPermissionVersion: { lt: version } }],
    },
    data: { verifiedReadPermissionVersion: version },
  });
  return { advanced: result.count > 0 };
}

/**
 * ADR-0023 §3.3/§3.7: advanced ONLY when a real, successful admin-consent
 * redirect completes through this application's own callback — this is an
 * assertion that the admin completed the consent dialog, never proof of
 * the effective (in particular, write) grant. Never call this from a
 * passive/background check (ADR-0023 §3.5). Conditioned the same way as
 * applyVerifiedReadPermission, for the same reasons.
 */
export async function applyConsentAssertion(
  microsoftTenantId: string,
  version: number,
  at: Date,
): Promise<{ advanced: boolean }> {
  const result = await prisma.microsoftTenant.updateMany({
    where: {
      id: microsoftTenantId,
      OR: [{ consentAssertedPermissionVersion: null }, { consentAssertedPermissionVersion: { lt: version } }],
    },
    data: { consentAssertedPermissionVersion: version, consentAssertedAt: at },
  });
  return { advanced: result.count > 0 };
}
