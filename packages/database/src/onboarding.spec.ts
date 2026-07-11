import { prisma } from './client';
import {
  provisionOrganizationFromConsent,
  provisionUserFromExistingTenant,
  resolveOrProvisionFromConsent,
} from './onboarding';
import { findUserByEntraIdentity } from './identity';

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

describe('Organization onboarding (ADR-0012 Acceptance Criteria)', () => {
  const createdOrgIds: string[] = [];

  afterEach(async () => {
    if (createdOrgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
      createdOrgIds.length = 0;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Criterion 1 & 3: first admin consent bootstraps Organization + MicrosoftTenant + Admin User', () => {
    it('creates exactly one Organization, one MicrosoftTenant, and one Active Admin User', async () => {
      const entraTenantId = unique('tid');
      const entraObjectId = unique('oid');
      const tenantName = unique('org');

      const result = await provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName, {
        email: 'admin@example.com',
        displayName: 'First Admin',
      });
      createdOrgIds.push(result.organizationId);

      const org = await prisma.organization.findUnique({ where: { id: result.organizationId } });
      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: result.microsoftTenantId } });
      const user = await prisma.user.findUnique({ where: { id: result.userId } });

      expect(org).not.toBeNull();
      expect(org?.name).toBe(tenantName);
      expect(tenant?.organizationId).toBe(org!.id);
      expect(tenant?.entraTenantId).toBe(entraTenantId);
      expect(tenant?.status).toBe('Consented');
      expect(user?.organizationId).toBe(org!.id);
      expect(user?.microsoftTenantId).toBe(tenant!.id);
      expect(user?.entraObjectId).toBe(entraObjectId);

      // Criterion 3: first admin gets role Admin, status Active, no approval step.
      expect(user?.role).toBe('Admin');
      expect(user?.status).toBe('Active');
    });

    it('backfills MicrosoftTenant.consentGrantedByUserId to the created User after creation', async () => {
      const entraTenantId = unique('tid');
      const result = await provisionOrganizationFromConsent(entraTenantId, unique('oid'), unique('org'), {
        email: 'admin@example.com',
        displayName: 'First Admin',
      });
      createdOrgIds.push(result.organizationId);

      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: result.microsoftTenantId } });
      expect(tenant?.consentGrantedByUserId).toBe(result.userId);
    });
  });

  describe('Criterion 2: existing entraTenantId cannot create a duplicate Organization', () => {
    it('routes a second consent attempt for an already-connected tenant into the existing Organization', async () => {
      const entraTenantId = unique('tid');
      const tenantName = unique('org');
      const profile = { email: 'person@example.com', displayName: 'Person' };

      const first = await resolveOrProvisionFromConsent(entraTenantId, unique('oid-admin'), tenantName, profile);
      expect(first.kind).toBe('bootstrapped');
      if (first.kind !== 'bootstrapped') throw new Error('unreachable');
      createdOrgIds.push(first.organizationId);

      const orgCountBefore = await prisma.organization.count();
      const second = await resolveOrProvisionFromConsent(
        entraTenantId,
        unique('oid-second-person'),
        tenantName,
        profile,
      );
      const orgCountAfter = await prisma.organization.count();

      expect(orgCountAfter).toBe(orgCountBefore); // no new Organization created
      expect(second.kind).toBe('provisioned-pending');
      if (second.kind !== 'provisioned-pending') throw new Error('unreachable');
      expect(second.organizationId).toBe(first.organizationId); // routed into the existing org
      expect(second.userId).not.toBe(first.userId); // still a distinct new User
    });

    it('returns the existing user, provisioning nothing new, when the same identity resolves twice', async () => {
      const entraTenantId = unique('tid');
      const entraObjectId = unique('oid');
      const tenantName = unique('org');
      const profile = { email: 'admin@example.com', displayName: 'Admin' };

      const first = await resolveOrProvisionFromConsent(entraTenantId, entraObjectId, tenantName, profile);
      if (first.kind !== 'bootstrapped') throw new Error('unreachable');
      createdOrgIds.push(first.organizationId);

      const userCountBefore = await prisma.user.count();
      const second = await resolveOrProvisionFromConsent(entraTenantId, entraObjectId, tenantName, profile);
      const userCountAfter = await prisma.user.count();

      if (second.kind !== 'existing') throw new Error('unreachable');
      expect(second.userId).toBe(first.userId);
      expect(userCountAfter).toBe(userCountBefore);
    });
  });

  describe('Criterion 4 (database half): new user from same tenant is pending, but identity still resolves', () => {
    it('provisions a second person from the same tenant as a pending, non-admin member', async () => {
      const entraTenantId = unique('tid');
      const admin = await provisionOrganizationFromConsent(entraTenantId, unique('oid-admin'), unique('org'), {
        email: 'admin@example.com',
        displayName: 'Admin',
      });
      createdOrgIds.push(admin.organizationId);

      const newPersonOid = unique('oid-new-person');
      const created = await provisionUserFromExistingTenant(
        { id: admin.microsoftTenantId, organizationId: admin.organizationId },
        newPersonOid,
        { email: 'new-person@example.com', displayName: 'New Person' },
      );

      expect(created.role).toBe('Member');
      expect(created.status).toBe('PendingApproval');
      expect(created.organizationId).toBe(admin.organizationId);

      // Identity resolution succeeds end-to-end once provisioned.
      const resolved = await findUserByEntraIdentity(entraTenantId, newPersonOid);
      expect(resolved?.id).toBe(created.id);
    });
  });

  describe('Criterion 5: a failed bootstrap transaction leaves no partial records', () => {
    it('rolls back completely if the transaction fails partway through', async () => {
      const entraTenantId = unique('tid');
      const entraObjectId = unique('oid');
      const tenantName = unique('org');
      const profile = { email: 'admin@example.com', displayName: 'Admin' };

      const orgCountBefore = await prisma.organization.count();
      const tenantCountBefore = await prisma.microsoftTenant.count();
      const userCountBefore = await prisma.user.count();

      // Reconstruct the bootstrap transaction's steps directly, but with a
      // foreign key that cannot possibly resolve on the final step — proves
      // the Organization and MicrosoftTenant created earlier in the SAME
      // transaction are rolled back together with it, not left behind.
      await expect(
        prisma.$transaction(async (tx) => {
          const organization = await tx.organization.create({ data: { name: tenantName } });
          await tx.microsoftTenant.create({
            data: {
              organizationId: organization.id,
              entraTenantId,
              tenantName,
              status: 'Consented',
            },
          });
          await tx.user.create({
            data: {
              organizationId: 'does-not-exist',
              microsoftTenantId: 'does-not-exist',
              entraObjectId,
              email: profile.email,
              displayName: profile.displayName,
            },
          });
        }),
      ).rejects.toThrow();

      expect(await prisma.organization.count()).toBe(orgCountBefore);
      expect(await prisma.microsoftTenant.count()).toBe(tenantCountBefore);
      expect(await prisma.user.count()).toBe(userCountBefore);
    });
  });
});
