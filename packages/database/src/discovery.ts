import type { MicrosoftTenant } from '@prisma/client';

/**
 * ADR-0014 amendment (2026-07-20): `MicrosoftTenant.discoveryStatus` in
 * Postgres is the single source of truth for "is a discovery operation
 * currently in flight for this tenant" — BullMQ's own queue state is never
 * consulted for this decision. Pure and framework-free so both the future
 * apps/api producer (Phase 1b) and any test can call it without queue or
 * HTTP infrastructure.
 */
export function shouldEnqueueDiscovery(tenant: Pick<MicrosoftTenant, 'discoveryStatus'>): boolean {
  return tenant.discoveryStatus !== 'Queued' && tenant.discoveryStatus !== 'Running';
}

/**
 * Deterministic BullMQ jobId — the queue-level dedup backstop described in
 * the same amendment (defense in depth, not the authoritative guard; see
 * shouldEnqueueDiscovery above for that).
 */
export function discoveryJobId(microsoftTenantId: string): string {
  return `discovery-${microsoftTenantId}`;
}
