import 'reflect-metadata';
import { createTenantContext, type TenantContext } from '@sph/database';
import type { DocumentOwnerInput, SiblingDocumentInput } from '@sph/scoring';
import { GovernanceActivityService } from '../../governance/governance-activity.service';
import { GovernanceIssuesService } from '../../governance/governance-issues.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DocumentsService } from '../../documents/documents.service';
import {
  DEMO_SITE_GRAPH_ID,
  DEMO_SITE_DISPLAY_NAME,
  DEMO_ASSIGNEE_ENTRA_ID,
  DEMO_ASSIGNEE_EMAIL,
  DEMO_ASSIGNEE_NAME,
  DEMO_PENDING_USER_ENTRA_ID,
  DEMO_PENDING_USER_EMAIL,
  DEMO_PENDING_USER_NAME,
  DEMO_SCAN_ID_PREFIX,
  DEMO_DOC_GRAPH_ID_PREFIX,
  seedMetadata,
} from './constants';
import { DOCUMENT_PLAN, type DocPlan } from './document-plan';
import { GOVERNANCE_ISSUE_PLAN, type GovernanceIssuePlan } from './governance-plan';
import { daysAgo, scoreAndPersist, stillDetected } from './lib';

// Spread across the same window governance-analytics.service.ts defaults
// to (DEFAULT_WINDOW_DAYS = 30) — recent enough that the trend/issuesByType/
// statusDistribution/resolutionTimeDistribution charts all have real
// points inside their default lookback, without any query-param tuning
// needed on the demo day.
const HISTORICAL_SCAN_DAYS_AGO = [28, 21, 14, 7, 1];

function parseOrganizationId(): string {
  const fromArg = process.argv.find((arg) => arg.startsWith('--organization-id='))?.split('=')[1];
  const organizationId = fromArg ?? process.env.DEMO_ORGANIZATION_ID;
  if (!organizationId) {
    console.error('Usage: pnpm demo:seed --organization-id=<id>  (or set DEMO_ORGANIZATION_ID)');
    process.exit(1);
  }
  return organizationId;
}

async function ensureDemoSite(
  context: TenantContext,
  microsoftTenantId: string,
  adminUserId: string,
  auditLog: AuditLogService,
  organizationId: string,
): Promise<{ id: string }> {
  const [existing] = await context.sharePointSites.findMany({ where: { graphSiteId: DEMO_SITE_GRAPH_ID }, take: 1 });
  if (existing) return existing;

  const site = await context.sharePointSites.create({
    microsoftTenantId,
    graphSiteId: DEMO_SITE_GRAPH_ID,
    siteUrl: 'https://contoso.sharepoint.com/sites/corporate-knowledge-base',
    displayName: DEMO_SITE_DISPLAY_NAME,
    status: 'Approved',
    approvedAt: new Date(),
    approvedByUserId: adminUserId,
  });

  // Mirrors SharePointSitesService.approveSite's exact audit entry shape —
  // that service also depends on DiscoveryProducerService (a live BullMQ
  // queue this standalone script has no reason to connect to), so this
  // calls AuditLogService directly instead of instantiating the whole
  // service just to reach a two-line method.
  await auditLog.record(organizationId, {
    actorUserId: adminUserId,
    action: 'sharepoint_site.approved',
    targetType: 'SharePointSite',
    targetId: site.id,
    metadata: seedMetadata(),
  });

  console.log(`Created demo site: ${DEMO_SITE_DISPLAY_NAME}`);
  return site;
}

async function ensureUser(
  context: TenantContext,
  microsoftTenantId: string,
  entraObjectId: string,
  email: string,
  displayName: string,
  status: 'Active' | 'PendingApproval',
): Promise<{ id: string; email: string; displayName: string }> {
  const [existing] = await context.users.findMany({ where: { entraObjectId }, take: 1 });
  if (existing) return existing;

  const user = await context.users.create({ microsoftTenantId, entraObjectId, email, displayName, role: 'Member', status });
  console.log(`Created demo user: ${displayName} (${status})`);
  return user;
}

interface ScanJobSummary {
  id: string;
  completedAt: Date;
}

async function ensureScanJobs(
  context: TenantContext,
  microsoftTenantId: string,
  auditLog: AuditLogService,
  organizationId: string,
  adminUserId: string,
): Promise<ScanJobSummary[]> {
  const results: ScanJobSummary[] = [];
  for (const [index, daysBack] of HISTORICAL_SCAN_DAYS_AGO.entries()) {
    const id = `${DEMO_SCAN_ID_PREFIX}${index + 1}`;
    const existing = await context.scanJobs.findFirstById(id);
    if (existing) {
      results.push({ id: existing.id, completedAt: existing.completedAt ?? daysAgo(daysBack) });
      continue;
    }

    const startedAt = daysAgo(daysBack);
    const completedAt = new Date(startedAt.getTime() + 4 * 60 * 1000); // a plausible ~4-minute scan
    const documentsScanned = 24 + index * 2; // grows slightly each scan, like a real tenant accumulating documents
    const job = await context.scanJobs.create({
      id,
      microsoftTenantId,
      triggeredByUserId: index === HISTORICAL_SCAN_DAYS_AGO.length - 1 ? adminUserId : null,
      triggerSource: index === HISTORICAL_SCAN_DAYS_AGO.length - 1 ? 'Manual' : 'Scheduled',
      status: 'Completed',
      startedAt,
      completedAt,
      documentsScanned,
      documentsFailed: 0,
      totalSites: 1,
      sitesCompleted: 1,
    });

    await auditLog.record(organizationId, {
      actorUserId: job.triggeredByUserId,
      action: 'scan.triggered',
      targetType: 'ScanJob',
      targetId: job.id,
      metadata: seedMetadata(),
    });

    results.push({ id: job.id, completedAt });
  }
  console.log(`Ensured ${results.length} historical scan jobs.`);
  return results;
}

interface SeededDocument {
  plan: DocPlan;
  documentId: string;
}

async function ensureDocuments(
  context: TenantContext,
  siteId: string,
  scanJobs: ScanJobSummary[],
  adminEmail: string,
  assigneeEmail: string,
): Promise<SeededDocument[]> {
  const seeded: SeededDocument[] = [];
  const latestScan = scanJobs[scanJobs.length - 1]!;

  for (const plan of DOCUMENT_PLAN) {
    const graphItemId = `${DEMO_DOC_GRAPH_ID_PREFIX}${String(plan.seq).padStart(3, '0')}`;
    const [existing] = await context.documents.findMany({ where: { siteId, graphItemId }, take: 1 });

    const sourceCreatedAt = daysAgo(plan.createdDaysAgo);
    const sourceModifiedAt = daysAgo(plan.modifiedDaysAgo);

    let documentId: string;
    if (existing) {
      documentId = existing.id;
      // Resilience: if a real scan ran against this org since the last
      // seed run, ADR-0004's reconciliation would have marked every
      // seeded document Removed (it no longer appears in a real Graph
      // enumeration of the real site it would need to live under — see
      // README.md's "why a dedicated site" note). Revive it rather than
      // silently leaving the demo dataset broken.
      if (existing.status !== 'Active') {
        await context.documents.updateById(documentId, { status: 'Active' });
      }
    } else {
      const created = await context.documents.create({
        siteId,
        graphItemId,
        name: plan.name,
        path: `/sites/corporate-knowledge-base/Shared Documents/${plan.name}`,
        fileType: plan.fileType,
        sizeBytes: BigInt(plan.sizeBytes),
        sourceCreatedAt,
        sourceModifiedAt,
        nextReviewDueAt: plan.hasReviewDate ? daysAgo(-90) : null, // 90 days in the future
      });
      documentId = created.id;

      if (plan.hasOwner) {
        // Mirrors DocumentCollectorProcessor.syncOwner's exact shape
        // (source: GraphMetadata, ownerType: Author) — that's a worker-side
        // direct repository write in production too, not a "service" to
        // instantiate.
        const email = plan.seq % 2 === 0 ? adminEmail : assigneeEmail;
        await context.documentOwners.create({
          documentId,
          ownerType: 'Author',
          displayName: email === adminEmail ? 'Organization Admin' : DEMO_ASSIGNEE_NAME,
          email,
          source: 'GraphMetadata',
        });
      }
    }

    seeded.push({ plan, documentId });
  }

  // Score every document together so Duplication's sibling comparison sees
  // the whole seeded set at once — exactly the shape
  // DocumentCollectorProcessor.scoreTenantDocuments already uses.
  const siblingsByKey = new Map<string, SiblingDocumentInput[]>();
  for (const { plan, documentId } of seeded) {
    const key = `${plan.name}::${plan.sizeBytes}`;
    const list = siblingsByKey.get(key) ?? [];
    list.push({ id: documentId, name: plan.name, sizeBytes: plan.sizeBytes });
    siblingsByKey.set(key, list);
  }

  for (const { plan, documentId } of seeded) {
    const existingScores = await context.healthScores.findMany({ where: { documentId }, take: 1 });
    if (existingScores.length > 0) continue; // already scored on a previous run

    const owners: DocumentOwnerInput[] = plan.hasOwner
      ? [{ email: plan.seq % 2 === 0 ? adminEmail : assigneeEmail, isActiveUser: null }]
      : [];
    const key = `${plan.name}::${plan.sizeBytes}`;

    const { healthScoreId } = await scoreAndPersist(
      context,
      latestScan.id,
      plan.name,
      documentId,
      owners,
      siblingsByKey.get(key) ?? [],
      plan.hasReviewDate,
      daysAgo(plan.createdDaysAgo),
      daysAgo(plan.modifiedDaysAgo),
      plan.sizeBytes,
      latestScan.completedAt,
    );

    await context.documents.updateById(documentId, { currentHealthScoreId: healthScoreId });
  }

  console.log(`Ensured ${seeded.length} demo documents, scored.`);
  return seeded;
}

async function createHistoricalIssue(
  context: TenantContext,
  governanceActivity: GovernanceActivityService,
  plan: GovernanceIssuePlan,
  documentId: string,
  issueSeverity: 'NeedsAttention' | 'RequiresReview',
  adminUserId: string,
  assigneeUserId: string,
): Promise<void> {
  const assigneeId = plan.assignedTo === 'admin' ? adminUserId : plan.assignedTo === 'assignee' ? assigneeUserId : null;
  const createdAt = daysAgo(plan.createdDaysAgo);

  // Direct repository create, not GovernanceIssuesService.createIssue() —
  // deliberately: createIssue() always stamps createdAt as "now", and
  // GovernanceActivity (see below) has no update path at all (ADR-0016,
  // immutable by construction). Backdating is only possible at the moment
  // of creation, through the same tenant-scoped repository layer the
  // service itself uses internally — never raw Prisma.
  const issue = await context.governanceIssues.create({
    documentId,
    issueType: plan.issueType,
    severity: issueSeverity,
    status: plan.status === 'Open' ? 'Open' : plan.status === 'InProgress' ? 'InProgress' : 'Resolved',
    assignedUserId: assigneeId,
    resolvedAt: plan.status === 'Resolved' ? daysAgo(plan.resolvedDaysAgo ?? 0) : null,
    createdAt,
    updatedAt: plan.status === 'Resolved' ? daysAgo(plan.resolvedDaysAgo ?? 0) : plan.status === 'InProgress' ? daysAgo(plan.inProgressDaysAgo ?? plan.createdDaysAgo) : createdAt,
  });

  // Activity trail — IssueCreated always; IssueAssigned if assigned at
  // creation; StatusChanged on the Open->InProgress edge; IssueResolved on
  // the InProgress->Resolved edge. Same activityType/previousValue/
  // newValue shapes GovernanceActivityService.record() would produce,
  // constructed directly so each row can carry its own historical
  // createdAt (record() has no such parameter — see the module comment).
  await context.governanceActivity.create({
    governanceIssueId: issue.id,
    documentId,
    actorUserId: adminUserId,
    activityType: 'IssueCreated',
    metadata: seedMetadata({ issueType: plan.issueType, severity: issueSeverity }) as object,
    createdAt,
  });

  if (assigneeId) {
    await context.governanceActivity.create({
      governanceIssueId: issue.id,
      documentId,
      actorUserId: adminUserId,
      activityType: 'IssueAssigned',
      newValue: assigneeId === adminUserId ? 'Organization Admin' : DEMO_ASSIGNEE_NAME,
      metadata: seedMetadata() as object,
      createdAt,
    });
  }

  if (plan.status === 'InProgress' || plan.status === 'Resolved') {
    const at = daysAgo(plan.inProgressDaysAgo ?? plan.createdDaysAgo);
    await context.governanceActivity.create({
      governanceIssueId: issue.id,
      documentId,
      actorUserId: assigneeId ?? adminUserId,
      activityType: 'StatusChanged',
      previousValue: 'Open',
      newValue: 'InProgress',
      metadata: seedMetadata() as object,
      createdAt: at,
    });
  }

  if (plan.status === 'Resolved') {
    const at = daysAgo(plan.resolvedDaysAgo ?? 0);
    await context.governanceActivity.create({
      governanceIssueId: issue.id,
      documentId,
      actorUserId: assigneeId ?? adminUserId,
      activityType: 'IssueResolved',
      previousValue: 'InProgress',
      newValue: 'Resolved',
      metadata: seedMetadata() as object,
      createdAt: at,
    });
  }
}

async function ensureGovernanceIssues(
  context: TenantContext,
  seededDocs: SeededDocument[],
  governanceActivity: GovernanceActivityService,
  governanceIssues: GovernanceIssuesService,
  organizationId: string,
  adminUserId: string,
  assigneeUserId: string,
): Promise<void> {
  const bySeq = new Map(seededDocs.map((doc) => [doc.plan.seq, doc.documentId]));
  let created = 0;

  for (const plan of GOVERNANCE_ISSUE_PLAN) {
    const documentId = bySeq.get(plan.docSeq);
    if (!documentId) throw new Error(`document-plan.ts has no document with seq ${plan.docSeq}`);

    const already = await context.governanceIssues.findMany({ where: { documentId, issueType: plan.issueType }, take: 1 });
    if (already.length > 0) continue; // idempotent — already seeded

    const [healthIssue] = await context.healthIssues.findMany({
      where: { criterion: plan.issueType, healthScore: { documentId } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (!healthIssue) {
      console.warn(`Skipping governance issue for doc seq ${plan.docSeq}: no matching HealthIssue (${plan.issueType}) was detected.`);
      continue;
    }

    if (plan.live) {
      // The one live, current-moment issue — real service calls, exactly
      // as a human clicking through the UI right now would produce.
      const response = await governanceIssues.createIssue(organizationId, adminUserId, {
        documentId,
        issueType: plan.issueType,
      });
      if (plan.assignedTo !== 'none') {
        const assignedUserId = plan.assignedTo === 'admin' ? adminUserId : assigneeUserId;
        await governanceIssues.updateIssue(organizationId, response.id, adminUserId, 'Admin', { assignedUserId });
      }
    } else {
      await createHistoricalIssue(context, governanceActivity, plan, documentId, healthIssue.severity, adminUserId, assigneeUserId);
    }
    created += 1;
  }

  console.log(`Ensured ${created} newly-created governance issues (${GOVERNANCE_ISSUE_PLAN.length - created} already existed).`);
}

// ADR-0021 §3.3's reconciliation mechanism, invoked directly against the
// specific issues this seed run wants to demonstrate it on — not a full
// NotificationReconciliationService.reconcileForOrganization() sweep,
// since that would also touch every other Open/InProgress issue in the
// org (including real, non-demo ones) on every seed run. Same
// upsertByDedupeKey call that service itself uses, so the concurrency-safe
// dedup guarantee is identical.
async function simulateResolutionSuggested(
  context: TenantContext,
  seededDocs: SeededDocument[],
  scanJobId: string,
): Promise<void> {
  const bySeq = new Map(seededDocs.map((doc) => [doc.plan.seq, doc.documentId]));

  for (const plan of GOVERNANCE_ISSUE_PLAN) {
    if (!plan.simulateResolutionSuggested) continue;
    const documentId = bySeq.get(plan.docSeq)!;

    const [issue] = await context.governanceIssues.findMany({ where: { documentId, issueType: plan.issueType }, take: 1 });
    if (!issue || !issue.assignedUserId || issue.status === 'Resolved') continue;

    const document = await context.documents.findFirstById(documentId);
    if (!document) continue;

    // Idempotency: if a prior run of this script already created the
    // "fixed" HealthScore and pointed currentHealthScoreId at it, the
    // criterion is already gone from the current score — skip creating
    // another one (and re-upserting the notification, which would be a
    // harmless no-op anyway via dedupeKey, but the extra HealthScore row
    // would not be — "running multiple times should not duplicate
    // records" applies here too).
    if (document.currentHealthScoreId) {
      const alreadyFixed = await context.healthIssues.findMany({
        where: { healthScoreId: document.currentHealthScoreId, criterion: plan.issueType },
        take: 1,
      });
      if (alreadyFixed.length === 0) continue;
    }

    // Make the fix genuinely real, not just a scoring input — every
    // GOVERNANCE_ISSUE_PLAN entry that sets simulateResolutionSuggested
    // today is a ReviewStatus issue, so this updates the one real column
    // that criterion actually reads (Document.nextReviewDueAt). A HealthScore
    // that merely *claims* hasReviewDate: true without this would be a
    // scoring-input illusion — the next time any real scan re-scores this
    // document from its actual stored data, it would find nextReviewDueAt
    // still null, re-detect the issue, and silently undo the simulated
    // fix. Confirmed live: exactly this happened during this script's own
    // development, caught by re-querying between runs.
    if (plan.issueType === 'ReviewStatus') {
      await context.documents.updateById(documentId, { nextReviewDueAt: daysAgo(-90) }); // 90 days in the future
    } else {
      throw new Error(
        `simulateResolutionSuggested only knows how to durably fix a ReviewStatus issue today — extend this before using it for ${plan.issueType}.`,
      );
    }

    const updatedDocument = await context.documents.findFirstById(documentId);
    const { healthScoreId, issues: newIssues } = await scoreAndPersist(
      context,
      scanJobId,
      document.name,
      documentId,
      [{ email: DEMO_ASSIGNEE_EMAIL, isActiveUser: null }],
      [],
      updatedDocument!.nextReviewDueAt !== null,
      document.sourceCreatedAt,
      new Date(), // modified "now" — someone just added the review date
      Number(document.sizeBytes),
      new Date(),
    );
    await context.documents.updateById(documentId, { currentHealthScoreId: healthScoreId });

    const detectedKeys = new Set(newIssues.map((i) => `${healthScoreId}:${i.criterion}`));
    if (stillDetected(healthScoreId, plan.issueType, detectedKeys)) continue; // still genuinely detected — don't fake a false resolution

    await context.notifications.upsertByDedupeKey({
      dedupeKey: `${issue.id}:${issue.updatedAt.getTime()}`,
      userId: issue.assignedUserId,
      type: 'ResolutionSuggested',
      message: `A rescan no longer detects this ${issue.issueType} issue — confirm and resolve?`,
      governanceIssueId: issue.id,
      documentId,
    });
    console.log(`Simulated a ResolutionSuggested notification for doc seq ${plan.docSeq}.`);
  }
}

async function main(): Promise<void> {
  const organizationId = parseOrganizationId();
  const context = createTenantContext(organizationId);

  const organization = await context.organization.get();
  if (!organization) {
    console.error(`No organization found with id "${organizationId}". Refusing to seed into an unknown organization.`);
    process.exit(1);
  }
  console.log(`Seeding demo data into organization: "${organization.name}" (${organization.id})`);

  const tenants = await context.microsoftTenants.findMany();
  const tenant = tenants[0];
  if (!tenant) {
    console.error('This organization has no connected Microsoft tenant yet. Complete real onboarding first, then re-run.');
    process.exit(1);
  }

  const [admin] = await context.users.findMany({ where: { role: 'Admin', status: 'Active' }, take: 1 });
  if (!admin) {
    console.error('This organization has no Active Admin user yet. Sign in as the org admin at least once first.');
    process.exit(1);
  }

  const governanceActivityService = new GovernanceActivityService();
  const governanceIssuesService = new GovernanceIssuesService(governanceActivityService);
  const auditLogService = new AuditLogService();
  const documentsService = new DocumentsService(governanceActivityService);

  const site = await ensureDemoSite(context, tenant.id, admin.id, auditLogService, organizationId);
  const assignee = await ensureUser(context, tenant.id, DEMO_ASSIGNEE_ENTRA_ID, DEMO_ASSIGNEE_EMAIL, DEMO_ASSIGNEE_NAME, 'Active');
  await ensureUser(context, tenant.id, DEMO_PENDING_USER_ENTRA_ID, DEMO_PENDING_USER_EMAIL, DEMO_PENDING_USER_NAME, 'PendingApproval');

  const scanJobs = await ensureScanJobs(context, tenant.id, auditLogService, organizationId, admin.id);
  const seededDocs = await ensureDocuments(context, site.id, scanJobs, admin.email, assignee.email);

  await ensureGovernanceIssues(
    context,
    seededDocs,
    governanceActivityService,
    governanceIssuesService,
    organizationId,
    admin.id,
    assignee.id,
  );

  await simulateResolutionSuggested(context, seededDocs, scanJobs[scanJobs.length - 1]!.id);

  // A second, live-today ownership assignment (self-assign trick, see
  // README.md) — real DocumentsService.assignOwner() call, so it produces
  // a genuine OwnerAssigned notification through the real mechanism, not a
  // fabricated one. Targets one of the "healthy" documents.
  //
  // Requires the admin's own User.email to be non-empty:
  // resolveOwnerUserId (apps/api/src/common/resolve-owner-user.ts)
  // correctly treats an empty string the same as "no email" and returns
  // null, so no notification would silently be created otherwise. If this
  // warns below, that's the same pre-existing, already-documented gap the
  // LAT report's F7 finding flagged (an Entra App Registration optional-
  // claims configuration issue, not something this script — or the
  // application code it calls — can or should work around). The primary
  // live notification demo moment (self-assigning the governance issue
  // above) is unaffected either way, since that path notifies by user id,
  // never by email.
  const healthyDoc = seededDocs.find((doc) => doc.plan.seq === 4); // "Product Roadmap H2 2026.xlsx"
  if (healthyDoc) {
    if (!admin.email) {
      console.warn(
        'Skipping the self-owner-assignment demo notification: the Admin user has no email on file ' +
          '(LAT report F7 — an Entra optional-claims configuration gap, not a bug in this script). ' +
          'The governance-issue self-assignment notification above is unaffected.',
      );
    } else {
      const existingOwners = await context.documentOwners.findMany({ where: { documentId: healthyDoc.documentId, source: 'ManualAssignment' } });
      if (existingOwners.length === 0) {
        await documentsService.assignOwner(organizationId, healthyDoc.documentId, admin.id, {
          displayName: 'Organization Admin',
          email: admin.email,
        });
        console.log('Assigned the demo admin as a manual owner (live, generates a real OwnerAssigned notification).');
      }
    }
  }

  console.log('\nDemo data seed complete.');
  console.log(`  Organization: ${organization.name}`);
  console.log(`  Demo site:    ${DEMO_SITE_DISPLAY_NAME}`);
  console.log(`  Documents:    ${seededDocs.length}`);
  console.log(`  Scan jobs:    ${scanJobs.length}`);
  console.log(`  Demo users:   ${DEMO_ASSIGNEE_NAME} (Active), ${DEMO_PENDING_USER_NAME} (PendingApproval — approve live during the demo)`);
}

main()
  .catch((error) => {
    console.error('Demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // No explicit prisma.$disconnect() call here — @sph/database's
    // `prisma` client is process-scoped, same as apps/api/apps/worker's
    // own bootstrap; letting the process exit naturally closes the
    // connection, matching how every other short-lived script in this
    // repo (e.g. `prisma migrate deploy` invocations) already behaves.
  });
