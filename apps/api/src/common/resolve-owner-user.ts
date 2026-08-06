import type { TenantContext } from '@sph/database';

/**
 * Resolves a DocumentOwner-shaped email to a registered, Active platform
 * User — the same "is this owner a resolvable platform user" check
 * packages/scoring's Ownership criterion already performs
 * (apps/worker/src/queue/document-collector.processor.ts's
 * scoreTenantDocuments), reused here for two related purposes (ADR-0021):
 * notifying a newly assigned document owner, and defaulting a new
 * GovernanceIssue's assignee to the document's existing owner. Returns
 * null if there's no email to resolve or no matching Active user — never
 * throws, since "not resolvable" (an external or unregistered owner) is an
 * expected, common case, not an error.
 */
export async function resolveOwnerUserId(context: TenantContext, email: string | null | undefined): Promise<string | null> {
  if (!email) return null;
  const [user] = await context.users.findMany({ where: { email, status: 'Active' }, take: 1 });
  return user?.id ?? null;
}
