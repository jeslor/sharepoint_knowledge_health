// Public surface of @sph/database. Deliberately does NOT export the raw
// PrismaClient singleton (see client.ts) — this is the actual enforcement
// mechanism for ADR-0001: consumers can only obtain tenant-scoped access
// via createTenantContext(), or the one sanctioned unscoped identity lookup.

export { createTenantContext } from './tenant-context';
export type { TenantContext } from './tenant-context';
export { findUserByEntraIdentity } from './identity';

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
  HealthBand,
  HealthIssueCriterion,
  HealthIssueSeverity,
} from '@prisma/client';
