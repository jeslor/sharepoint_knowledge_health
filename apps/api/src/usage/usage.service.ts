import { Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type OrganizationEntitlement } from '@sph/database';
import type { UsageResponse } from '@sph/types';

/**
 * Single source of truth for interpreting OrganizationEntitlement's raw
 * counters as the frontend-facing usage shape (Phase 4). Mirrors the exact
 * comparison packages/database's entitlement.ts (tryConsumeDocumentSlot)
 * uses at the database level — `currentDocumentCount < documentLimit` to
 * grant one more slot — so this can never drift into showing "you have
 * room" when the worker would actually reject the next document, or vice
 * versa. Exported (not just used inline) so a unit test can exercise the
 * pure derivation directly, matching scans.service.ts's toScanResponse
 * precedent.
 */
export function toUsageResponse(entitlement: OrganizationEntitlement): UsageResponse {
  const { planType, documentLimit, currentDocumentCount } = entitlement;

  // Defensive only — every write path in this codebase keeps documentLimit
  // >= 1 (schema @default(2000), entitlement-backfill.ts's
  // DEFAULT_TRIAL_DOCUMENT_LIMIT). Guards against a division by zero/NaN
  // reaching the client if that invariant is ever violated, rather than
  // surfacing a broken number.
  const usagePercentage = documentLimit > 0 ? Math.round((currentDocumentCount / documentLimit) * 10000) / 100 : null;

  return {
    planType,
    documentLimit,
    currentDocumentCount,
    remainingDocumentCount: Math.max(documentLimit - currentDocumentCount, 0),
    usagePercentage,
    limitReached: currentDocumentCount >= documentLimit,
  };
}

@Injectable()
export class UsageService {
  /**
   * A single tenant-scoped OrganizationEntitlement row lookup — the
   * materialized counter Phase 1-3 already maintain, never a live
   * `COUNT(Document WHERE status = Active)`. No Microsoft Graph calls, no
   * Document/HealthScore queries, no joins: cheap enough to poll from the
   * frontend.
   */
  async getUsage(organizationId: string): Promise<UsageResponse> {
    const context = createTenantContext(organizationId);
    const entitlement = await context.entitlement.get();
    if (!entitlement) {
      // Fail closed, matching entitlement.ts's own NoEntitlementError
      // philosophy — every organization is expected to have exactly one
      // entitlement row (onboarding.ts's provisionOrganizationFromConsent,
      // or entitlement-backfill.ts for pre-existing organizations). A
      // missing row is an invariant violation, not a "treat as unlimited"
      // or "treat as zero usage" case.
      throw new NotFoundException('No entitlement found for this organization');
    }

    return toUsageResponse(entitlement);
  }
}
