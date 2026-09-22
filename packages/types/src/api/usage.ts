// Phase 4: read-only exposure of the trial-entitlement state Phase 1-3
// already enforce (packages/database's entitlement.ts/document-lifecycle.ts,
// apps/worker's document-collector.processor.ts). This is a reporting
// contract, not an enforcement one — the worker remains the sole
// authoritative gate on document creation; nothing here rejects a request
// based on usage.

export type OrganizationPlanTypeValue = 'Trial' | 'Standard';

export interface UsageResponse {
  planType: OrganizationPlanTypeValue;
  documentLimit: number;
  currentDocumentCount: number;
  // Invariant: remainingDocumentCount === max(documentLimit - currentDocumentCount, 0).
  // Never negative, even if currentDocumentCount momentarily exceeds
  // documentLimit (this is a plain read, not transactional with any
  // writer) or documentLimit is defensively invalid (see usagePercentage).
  remainingDocumentCount: number;
  // Invariant: round(currentDocumentCount / documentLimit * 100, 2 decimal
  // places) when documentLimit > 0, otherwise null. Intentionally NOT
  // rounded to a whole-number percentage — the current model's document
  // limit (2000) is large enough that whole-number rounding would show
  // 100% while a slot genuinely remains (e.g. 1999/2000 rounds to 100 as
  // an integer, but is 99.95 at two decimals) — null unambiguously means
  // "not a meaningful percentage for this organization," never 0.
  usagePercentage: number | null;
  // Invariant: limitReached === (currentDocumentCount >= documentLimit) —
  // the exact negation of the condition entitlement.ts's
  // tryConsumeDocumentSlot requires to grant one more slot. Mirrors, never
  // recomputes independently of, that worker-authoritative comparison.
  limitReached: boolean;
}
