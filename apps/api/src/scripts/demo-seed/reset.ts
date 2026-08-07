import 'reflect-metadata';
import { createTenantContext } from '@sph/database';
import { DEMO_SITE_GRAPH_ID, DEMO_ASSIGNEE_ENTRA_ID, DEMO_PENDING_USER_ENTRA_ID, DEMO_SCAN_ID_PREFIX } from './constants';

/**
 * Removes everything seed.ts created, and nothing else. A manual,
 * operator-run cleanup tool — never imported by any application flow,
 * never scheduled, never reachable through the API.
 *
 * Uses only createTenantContext()'s sanctioned repository layer — no raw
 * Prisma client (packages/database's own package.json `exports` map
 * deliberately blocks importing anything but its public index anyway).
 * Deleting the demo SharePointSite is sufficient to remove everything
 * beneath it: `Document.siteId`, `DocumentOwner.documentId`,
 * `HealthScore.documentId`, `HealthIssue.healthScoreId`,
 * `GovernanceIssue.documentId`, and `GovernanceActivity.documentId` /
 * `.governanceIssueId` are all `onDelete: Cascade` in the schema
 * (prisma/schema.prisma) — one delete call cascades the entire demo
 * document tree. This deliberately never routes through
 * GovernanceActivityRepository or AuditLogRepository directly, since
 * neither exposes a delete method by design (ADR-0016/ADR-0019:
 * "enforced by the public API shape itself, not just convention") — that
 * invariant protects the application from ever mutating its own audit
 * trail, and this script doesn't need to violate it: the database's own
 * cascade rules remove the dependent GovernanceActivity rows without this
 * script ever calling a delete method on that repository at all.
 *
 * What this does NOT remove, and why:
 * - AuditLog entries this seed run created (site approved, scans
 *   triggered) — AuditLogRepository has no delete method at all; nothing
 *   references them via a foreign key, so leaving them in place is
 *   harmless (they describe things that genuinely happened) rather than
 *   something to force a deletion path around.
 * - Any Notification row that referenced a removed Document/GovernanceIssue
 *   — NotificationRepository also has no delete method; the schema's own
 *   SetNull (not Cascade, not Restrict) on those two FKs means the
 *   notification row survives with those two fields cleared automatically
 *   rather than blocking this cleanup.
 */

function parseOrganizationId(): string {
  const fromArg = process.argv.find((arg) => arg.startsWith('--organization-id='))?.split('=')[1];
  const organizationId = fromArg ?? process.env.DEMO_ORGANIZATION_ID;
  if (!organizationId) {
    console.error('Usage: pnpm demo:reset --organization-id=<id> --confirm  (or set DEMO_ORGANIZATION_ID)');
    process.exit(1);
  }
  return organizationId;
}

async function main(): Promise<void> {
  const organizationId = parseOrganizationId();
  const confirm = process.argv.includes('--confirm');
  const context = createTenantContext(organizationId);

  const organization = await context.organization.get();
  if (!organization) {
    console.error(`No organization found with id "${organizationId}".`);
    process.exit(1);
  }

  const [site] = await context.sharePointSites.findMany({ where: { graphSiteId: DEMO_SITE_GRAPH_ID }, take: 1 });
  const documentCount = site ? await context.documents.count({ where: { siteId: site.id } }) : 0;
  const scanJobs = await context.scanJobs.findMany({ where: { id: { startsWith: DEMO_SCAN_ID_PREFIX } } });
  const [assignee] = await context.users.findMany({ where: { entraObjectId: DEMO_ASSIGNEE_ENTRA_ID }, take: 1 });
  const [pending] = await context.users.findMany({ where: { entraObjectId: DEMO_PENDING_USER_ENTRA_ID }, take: 1 });

  console.log(`Demo data found for organization "${organization.name}" (${organization.id}):`);
  console.log(`  Demo site:                ${site ? 1 : 0}${site ? ` (cascades ${documentCount} documents and everything scored/triaged under them)` : ''}`);
  console.log(`  Historical scan jobs:     ${scanJobs.length}`);
  console.log(`  Demo users:               ${(assignee ? 1 : 0) + (pending ? 1 : 0)}`);
  console.log('  (AuditLog entries and any orphaned Notification references are intentionally left in place — see reset.ts\'s module comment.)');

  if (!confirm) {
    console.log('\nDry run only — nothing was deleted. Re-run with --confirm to actually delete the above.');
    return;
  }

  if (site) {
    await context.sharePointSites.deleteById(site.id);
    console.log('Deleted demo site (and everything cascaded beneath it).');
  }
  for (const job of scanJobs) {
    await context.scanJobs.deleteById(job.id);
  }
  if (scanJobs.length > 0) console.log(`Deleted ${scanJobs.length} historical scan jobs.`);
  if (assignee) await context.users.deleteById(assignee.id);
  if (pending) await context.users.deleteById(pending.id);
  if (assignee || pending) console.log('Deleted demo users.');

  console.log('\nDemo data removed.');
}

main().catch((error) => {
  console.error('Demo reset failed:', error);
  process.exitCode = 1;
});
