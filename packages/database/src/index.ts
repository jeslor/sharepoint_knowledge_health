// Public surface of @sph/database. Deliberately does NOT export the raw
// PrismaClient singleton (see client.ts) — this is the actual enforcement
// mechanism for ADR-0001: consumers can only obtain tenant-scoped access
// via createTenantContext(), or the one sanctioned unscoped identity lookup.

export { createTenantContext } from './tenant-context';
export type { TenantContext } from './tenant-context';
export { findUserByEntraIdentity } from './identity';
export {
  findMicrosoftTenantByEntraTenantId,
  provisionOrganizationFromConsent,
  provisionUserFromExistingTenant,
  resolveOrProvisionFromConsent,
} from './onboarding';
export type { EntraProfile, BootstrapResult, ConsentResolution } from './onboarding';
export { ConsentVerificationError } from './consent-verifier';
export type { ConsentVerifier } from './consent-verifier';
export { findDueScanSchedules } from './scheduler';
export { findOrganizationIdsWithOpenGovernanceIssues } from './notification-reconciliation';
export { shouldEnqueueDiscovery, discoveryJobId } from './discovery';
export { recoverStaleScanJobs } from './scan-recovery';
export { recoverStaleDiscoveries } from './discovery-recovery';
export { checkDatabaseConnection } from './health-check';
export { REQUIRED_GRAPH_PERMISSIONS, REQUIRED_PERMISSION_VERSION } from './graph-permissions';
export { derivePermissionReconsentState, applyVerifiedReadPermission, applyConsentAssertion } from './permission-state';
export type { PermissionReconsentState } from './permission-state';
export { createRemediationJobWithItems } from './remediation';
export type { CreateRemediationJobInput, RemediationJobWithItems } from './remediation';
export { resolveGovernanceIssueForRemediation } from './governance-resolution';
export type { ResolveGovernanceIssueForRemediationInput, ResolveGovernanceIssueForRemediationResult } from './governance-resolution';
export { tryConsumeDocumentSlot, releaseDocumentSlot, NoEntitlementError } from './entitlement';
export type { EntitlementDbClient, DocumentSlotResult } from './entitlement';
export { backfillOrganizationEntitlements, DEFAULT_TRIAL_DOCUMENT_LIMIT } from './entitlement-backfill';
export type { EntitlementBackfillResult } from './entitlement-backfill';
export { createDocumentWithQuota, markDocumentRemovedAndReleaseSlot } from './document-lifecycle';
export type { CreateDocumentWithQuotaInput, CreateDocumentWithQuotaResult, MarkDocumentRemovedResult } from './document-lifecycle';

export type {
  Organization,
  User,
  MicrosoftTenant,
  SharePointSite,
  Document,
  DocumentOwner,
  ScanJob,
  HealthScore,
  HealthIssue,
  HealthSnapshot,
  ScanSchedule,
  GovernanceIssue,
  GovernanceActivity,
  AuditLog,
  Notification,
  SharePointReviewDateMapping,
  SharePointClassificationField,
  RemediationJob,
  RemediationItem,
  OrganizationEntitlement,
} from '@prisma/client';

export {
  OrganizationStatus,
  UserRole,
  UserStatus,
  MicrosoftTenantStatus,
  DocumentStatus,
  DocumentOwnerType,
  DocumentOwnerSource,
  ScanJobStatus,
  ScanJobTriggerSource,
  HealthBand,
  HealthIssueCriterion,
  HealthIssueSeverity,
  ScanScheduleFrequency,
  GovernanceIssueStatus,
  DocumentReviewDateSource,
  GovernanceActivityType,
  DiscoveryStatus,
  NotificationType,
  SharePointReviewDateMappingStatus,
  SharePointClassificationFieldStatus,
  RemediationJobStatus,
  RemediationItemStatus,
  OrganizationPlanType,
} from '@prisma/client';
