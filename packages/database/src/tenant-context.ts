import { prisma } from './client';
import { OrganizationRepository } from './repositories/organization-repository';
import { UserRepository } from './repositories/user-repository';
import { MicrosoftTenantRepository } from './repositories/microsoft-tenant-repository';
import { SharePointSiteRepository } from './repositories/sharepoint-site-repository';
import { DocumentRepository } from './repositories/document-repository';
import { DocumentOwnerRepository } from './repositories/document-owner-repository';
import { ScanJobRepository } from './repositories/scan-job-repository';
import { HealthScoreRepository } from './repositories/health-score-repository';
import { HealthIssueRepository } from './repositories/health-issue-repository';
import { HealthSnapshotRepository } from './repositories/health-snapshot-repository';
import { ScanScheduleRepository } from './repositories/scan-schedule-repository';
import { GovernanceIssueRepository } from './repositories/governance-issue-repository';
import { GovernanceActivityRepository } from './repositories/governance-activity-repository';
import { AuditLogRepository } from './repositories/audit-log-repository';
import { NotificationRepository } from './repositories/notification-repository';
import { SharePointReviewDateMappingRepository } from './repositories/sharepoint-review-date-mapping-repository';
import { RemediationJobRepository } from './repositories/remediation-job-repository';
import { RemediationItemRepository } from './repositories/remediation-item-repository';

export interface TenantContext {
  readonly organizationId: string;
  readonly organization: OrganizationRepository;
  readonly users: UserRepository;
  readonly microsoftTenants: MicrosoftTenantRepository;
  readonly sharePointSites: SharePointSiteRepository;
  readonly documents: DocumentRepository;
  readonly documentOwners: DocumentOwnerRepository;
  readonly scanJobs: ScanJobRepository;
  readonly healthScores: HealthScoreRepository;
  readonly healthIssues: HealthIssueRepository;
  readonly healthSnapshots: HealthSnapshotRepository;
  readonly scanSchedules: ScanScheduleRepository;
  readonly governanceIssues: GovernanceIssueRepository;
  readonly governanceActivity: GovernanceActivityRepository;
  readonly auditLogs: AuditLogRepository;
  readonly notifications: NotificationRepository;
  readonly sharePointReviewDateMappings: SharePointReviewDateMappingRepository;
  readonly remediationJobs: RemediationJobRepository;
  readonly remediationItems: RemediationItemRepository;
}

/**
 * The only sanctioned way to obtain tenant-scoped database access
 * (ADR-0001). organizationId is a required argument — every repository
 * returned here is permanently bound to it, so it is structurally
 * impossible to run a query without tenant scoping through this API.
 */
export function createTenantContext(organizationId: string): TenantContext {
  return {
    organizationId,
    organization: new OrganizationRepository(organizationId, prisma),
    users: new UserRepository(organizationId, prisma),
    microsoftTenants: new MicrosoftTenantRepository(organizationId, prisma),
    sharePointSites: new SharePointSiteRepository(organizationId, prisma),
    documents: new DocumentRepository(organizationId, prisma),
    documentOwners: new DocumentOwnerRepository(organizationId, prisma),
    scanJobs: new ScanJobRepository(organizationId, prisma),
    healthScores: new HealthScoreRepository(organizationId, prisma),
    healthIssues: new HealthIssueRepository(organizationId, prisma),
    healthSnapshots: new HealthSnapshotRepository(organizationId, prisma),
    scanSchedules: new ScanScheduleRepository(organizationId, prisma),
    governanceIssues: new GovernanceIssueRepository(organizationId, prisma),
    governanceActivity: new GovernanceActivityRepository(organizationId, prisma),
    auditLogs: new AuditLogRepository(organizationId, prisma),
    notifications: new NotificationRepository(organizationId, prisma),
    sharePointReviewDateMappings: new SharePointReviewDateMappingRepository(organizationId, prisma),
    remediationJobs: new RemediationJobRepository(organizationId, prisma),
    remediationItems: new RemediationItemRepository(organizationId, prisma),
  };
}
