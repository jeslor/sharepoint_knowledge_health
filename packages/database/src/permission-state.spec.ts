import { prisma } from './client';
import { provisionOrganizationFromConsent } from './onboarding';
import { applyConsentAssertion, applyVerifiedReadPermission, derivePermissionReconsentState } from './permission-state';

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createConsentedTenant(): Promise<{ organizationId: string; microsoftTenantId: string }> {
  const result = await provisionOrganizationFromConsent(unique('tid'), unique('oid'), unique('org'), {
    email: 'admin@example.com',
    displayName: 'Admin',
  });
  return result;
}

describe('permission-state (ADR-0023)', () => {
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

  describe('applyVerifiedReadPermission', () => {
    it('advances verifiedReadPermissionVersion from null and reports advanced: true', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      const result = await applyVerifiedReadPermission(microsoftTenantId, 1);
      expect(result).toEqual({ advanced: true });

      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.verifiedReadPermissionVersion).toBe(1);
    });

    it('does not advance, and reports advanced: false, when called again at the same version (no duplicate work)', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyVerifiedReadPermission(microsoftTenantId, 1);
      const second = await applyVerifiedReadPermission(microsoftTenantId, 1);

      expect(second).toEqual({ advanced: false });
      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.verifiedReadPermissionVersion).toBe(1);
    });

    it('advances further when called with a higher version (simulating a required-version bump)', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyVerifiedReadPermission(microsoftTenantId, 1);
      const result = await applyVerifiedReadPermission(microsoftTenantId, 2);

      expect(result).toEqual({ advanced: true });
      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.verifiedReadPermissionVersion).toBe(2);
    });

    it('never regresses a higher stored version if called with a lower one', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyVerifiedReadPermission(microsoftTenantId, 2);
      const result = await applyVerifiedReadPermission(microsoftTenantId, 1);

      expect(result).toEqual({ advanced: false });
      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.verifiedReadPermissionVersion).toBe(2);
    });

    it('never touches consentAssertedPermissionVersion or consentAssertedAt (critical separation)', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyVerifiedReadPermission(microsoftTenantId, 1);

      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.consentAssertedPermissionVersion).toBeNull();
      expect(tenant?.consentAssertedAt).toBeNull();
    });
  });

  describe('applyConsentAssertion', () => {
    it('advances consentAssertedPermissionVersion and records consentAssertedAt', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);
      const at = new Date();

      const result = await applyConsentAssertion(microsoftTenantId, 1, at);
      expect(result).toEqual({ advanced: true });

      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.consentAssertedPermissionVersion).toBe(1);
      expect(tenant?.consentAssertedAt?.toISOString()).toBe(at.toISOString());
    });

    it('does not advance, and reports advanced: false, when called again at the same version (no duplicate audit trigger)', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyConsentAssertion(microsoftTenantId, 1, new Date());
      const second = await applyConsentAssertion(microsoftTenantId, 1, new Date());

      expect(second).toEqual({ advanced: false });
    });

    it('never touches verifiedReadPermissionVersion (critical separation)', async () => {
      const { organizationId, microsoftTenantId } = await createConsentedTenant();
      createdOrgIds.push(organizationId);

      await applyConsentAssertion(microsoftTenantId, 1, new Date());

      const tenant = await prisma.microsoftTenant.findUnique({ where: { id: microsoftTenantId } });
      expect(tenant?.verifiedReadPermissionVersion).toBeNull();
    });
  });

  describe('derivePermissionReconsentState', () => {
    it('is false across the board for a PendingConsent tenant regardless of stored versions', () => {
      const state = derivePermissionReconsentState({
        status: 'PendingConsent',
        verifiedReadPermissionVersion: null,
        consentAssertedPermissionVersion: null,
      });
      expect(state).toEqual({ needsReadReconsent: false, needsWriteConsentAssertion: false, needsReconsent: false });
    });

    it('is false across the board for a Revoked tenant regardless of stored versions', () => {
      const state = derivePermissionReconsentState({
        status: 'Revoked',
        verifiedReadPermissionVersion: 5,
        consentAssertedPermissionVersion: 5,
      });
      expect(state).toEqual({ needsReadReconsent: false, needsWriteConsentAssertion: false, needsReconsent: false });
    });

    it('reports both signals true for a never-verified, never-asserted Consented tenant', () => {
      const state = derivePermissionReconsentState(
        { status: 'Consented', verifiedReadPermissionVersion: null, consentAssertedPermissionVersion: null },
        1,
      );
      expect(state).toEqual({ needsReadReconsent: true, needsWriteConsentAssertion: true, needsReconsent: true });
    });

    it('reports both signals false once both are at the current required version', () => {
      const state = derivePermissionReconsentState(
        { status: 'Consented', verifiedReadPermissionVersion: 1, consentAssertedPermissionVersion: 1 },
        1,
      );
      expect(state).toEqual({ needsReadReconsent: false, needsWriteConsentAssertion: false, needsReconsent: false });
    });

    it('simulates a required-version bump: a tenant fully current at version 1 becomes behind once the requirement moves to version 2', () => {
      const tenantAtVersion1 = { status: 'Consented' as const, verifiedReadPermissionVersion: 1, consentAssertedPermissionVersion: 1 };

      expect(derivePermissionReconsentState(tenantAtVersion1, 1).needsReconsent).toBe(false);
      expect(derivePermissionReconsentState(tenantAtVersion1, 2)).toEqual({
        needsReadReconsent: true,
        needsWriteConsentAssertion: true,
        needsReconsent: true,
      });
    });

    it('keeps the two signals independent: read-verified but not yet consent-asserted at the new version', () => {
      const state = derivePermissionReconsentState(
        { status: 'Consented', verifiedReadPermissionVersion: 2, consentAssertedPermissionVersion: 1 },
        2,
      );
      expect(state).toEqual({ needsReadReconsent: false, needsWriteConsentAssertion: true, needsReconsent: true });
    });

    it('keeps the two signals independent: consent-asserted but read-verification has not yet re-run at the new version', () => {
      const state = derivePermissionReconsentState(
        { status: 'Consented', verifiedReadPermissionVersion: 1, consentAssertedPermissionVersion: 2 },
        2,
      );
      expect(state).toEqual({ needsReadReconsent: true, needsWriteConsentAssertion: false, needsReconsent: true });
    });

    it('never claims Sites.ReadWrite.All has been independently verified: consentAssertedPermissionVersion at the current version never sets needsReadReconsent to false on its own', () => {
      // Read verification never ran (null) even though consent was just asserted.
      const state = derivePermissionReconsentState(
        { status: 'Consented', verifiedReadPermissionVersion: null, consentAssertedPermissionVersion: 1 },
        1,
      );
      expect(state.needsReadReconsent).toBe(true);
    });
  });
});
