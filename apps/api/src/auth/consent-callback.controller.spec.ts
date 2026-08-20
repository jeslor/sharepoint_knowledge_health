import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  applyConsentAssertion,
  applyVerifiedReadPermission,
  ConsentVerificationError,
  createTenantContext,
  derivePermissionReconsentState,
  REQUIRED_PERMISSION_VERSION,
  resolveOrProvisionFromConsent,
  type ConsentResolution,
} from '@sph/database';
import { verifyEntraToken } from './entra-jwt.guard';
import { ConsentCallbackController } from './consent-callback.controller';
import type { DiscoveryProducerService } from '../discovery/discovery-producer.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { GraphConsentVerifierService } from './graph-consent-verifier.service';

jest.mock('@sph/database');
jest.mock('./entra-jwt.guard', () => ({
  ...jest.requireActual('./entra-jwt.guard'),
  verifyEntraToken: jest.fn(),
}));

const mockedResolve = resolveOrProvisionFromConsent as jest.MockedFunction<typeof resolveOrProvisionFromConsent>;
const mockedVerify = verifyEntraToken as jest.MockedFunction<typeof verifyEntraToken>;
const mockedApplyConsentAssertion = applyConsentAssertion as jest.MockedFunction<typeof applyConsentAssertion>;
const mockedApplyVerifiedReadPermission = applyVerifiedReadPermission as jest.MockedFunction<typeof applyVerifiedReadPermission>;
const mockedDerivePermissionReconsentState = derivePermissionReconsentState as jest.MockedFunction<typeof derivePermissionReconsentState>;
const mockedCreateTenantContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

type RejectedReason = Extract<ConsentResolution, { kind: 'rejected' }>['reason'];

function resolution(kind: ConsentResolution['kind'], reason: RejectedReason = 'tenant-not-consented'): ConsentResolution {
  if (kind === 'rejected') return { kind, reason };
  return { kind, organizationId: 'org-1', microsoftTenantId: 'tenant-1', userId: 'user-1' };
}

describe('ConsentCallbackController', () => {
  const discoveryProducer = { enqueueDiscovery: jest.fn() };
  const auditLog = { record: jest.fn() } as unknown as jest.Mocked<AuditLogService>;
  const consentVerifier = { verifyTenantConsent: jest.fn() } as unknown as jest.Mocked<GraphConsentVerifierService>;
  const findFirstById = jest.fn();
  const controller = new ConsentCallbackController(
    discoveryProducer as unknown as DiscoveryProducerService,
    auditLog,
    consentVerifier,
  );

  const previousClientId = process.env.ENTRA_CLIENT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENTRA_CLIENT_ID = 'client-id-1';
    mockedVerify.mockResolvedValue({ tid: 'entra-tenant-1', oid: 'entra-object-1', email: 'admin@contoso.com', name: 'Admin' });
    discoveryProducer.enqueueDiscovery.mockResolvedValue({ id: 'tenant-1', discoveryStatus: 'Queued' });

    // ADR-0023: default, "nothing material changed" mocks — most existing
    // tests don't care about permission-state side effects at all, so the
    // default must be inert (no audit noise, no unexpected throws).
    mockedApplyConsentAssertion.mockResolvedValue({ advanced: false });
    mockedApplyVerifiedReadPermission.mockResolvedValue({ advanced: false });
    consentVerifier.verifyTenantConsent.mockResolvedValue(undefined);
    mockedDerivePermissionReconsentState.mockReturnValue({
      needsReadReconsent: false,
      needsWriteConsentAssertion: false,
      needsReconsent: false,
    });
    findFirstById.mockResolvedValue({
      id: 'tenant-1',
      status: 'Consented',
      verifiedReadPermissionVersion: REQUIRED_PERMISSION_VERSION,
      consentAssertedPermissionVersion: REQUIRED_PERMISSION_VERSION,
    });
    mockedCreateTenantContext.mockReturnValue({
      microsoftTenants: { findFirstById },
    } as unknown as ReturnType<typeof createTenantContext>);
  });

  afterAll(() => {
    process.env.ENTRA_CLIENT_ID = previousClientId;
  });

  it('throws UnauthorizedException when ENTRA_CLIENT_ID is not configured', async () => {
    delete process.env.ENTRA_CLIENT_ID;

    await expect(controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' })).rejects.toThrow(UnauthorizedException);
    expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
  });

  it.each(['tenant-not-consented', 'graph-consent-not-verified'] as const)(
    'throws ForbiddenException on a rejected resolution (reason: %s), without enqueueing discovery, recording any audit entry, or touching permission state',
    async (reason) => {
      mockedResolve.mockResolvedValue(resolution('rejected', reason));

      await expect(controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' })).rejects.toThrow(ForbiddenException);
      expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
      expect(mockedApplyConsentAssertion).not.toHaveBeenCalled();
      expect(mockedApplyVerifiedReadPermission).not.toHaveBeenCalled();
      expect(consentVerifier.verifyTenantConsent).not.toHaveBeenCalled();
    },
  );

  it('passes the injected GraphConsentVerifierService through to resolveOrProvisionFromConsent', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));

    await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(mockedResolve).toHaveBeenCalledWith(
      'entra-tenant-1',
      'entra-object-1',
      'Acme',
      { email: 'admin@contoso.com', displayName: 'Admin' },
      consentVerifier,
    );
  });

  it('enqueues discovery when the resolution is bootstrapped (a MicrosoftTenant just transitioned to Consented)', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));

    const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(discoveryProducer.enqueueDiscovery).toHaveBeenCalledWith('org-1', 'tenant-1');
    expect(result).toEqual({ ...resolution('bootstrapped'), needsReconsent: false });
  });

  it('records a microsoft_tenant.connected audit entry only for a bootstrapped resolution', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));

    await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(auditLog.record).toHaveBeenCalledWith('org-1', {
      actorUserId: 'user-1',
      action: 'microsoft_tenant.connected',
      targetType: 'MicrosoftTenant',
      targetId: 'tenant-1',
    });
  });

  it.each(['existing', 'provisioned-pending'] as const)(
    'does not enqueue discovery or record a microsoft_tenant.connected audit entry for kind: %s (not a fresh connection)',
    async (kind) => {
      mockedResolve.mockResolvedValue(resolution(kind));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalledWith('org-1', expect.objectContaining({ action: 'microsoft_tenant.connected' }));
    },
  );

  it('still returns the successful bootstrapped resolution even when enqueueing discovery fails', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));
    discoveryProducer.enqueueDiscovery.mockRejectedValue(new Error('Redis unavailable'));

    const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(result).toEqual({ ...resolution('bootstrapped'), needsReconsent: false });
    // The connection audit entry was already recorded before the
    // best-effort discovery enqueue was even attempted — a downstream
    // discovery failure must never retroactively un-log a connection that
    // genuinely happened.
    expect(auditLog.record).toHaveBeenCalledWith('org-1', expect.objectContaining({ action: 'microsoft_tenant.connected' }));
  });

  describe('ADR-0023: existing-tenant consent assertion + read-permission refresh', () => {
    it.each(['existing', 'bootstrapped', 'provisioned-pending'] as const)(
      'records a consent assertion for the current required version for kind: %s (reaching this endpoint at all means a real admin-consent redirect just completed)',
      async (kind) => {
        mockedResolve.mockResolvedValue(resolution(kind));

        await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

        expect(mockedApplyConsentAssertion).toHaveBeenCalledWith('tenant-1', REQUIRED_PERMISSION_VERSION, expect.any(Date));
      },
    );

    it('an existing tenant still resolves as existing and reaches the client successfully (the flow is a no-op for identity resolution, not a failure)', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(result.kind).toBe('existing');
    });

    it('records the microsoft_tenant.permission_consent_asserted audit entry only when the assertion actually advances', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      mockedApplyConsentAssertion.mockResolvedValue({ advanced: true });

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(auditLog.record).toHaveBeenCalledWith('org-1', {
        actorUserId: 'user-1',
        action: 'microsoft_tenant.permission_consent_asserted',
        targetType: 'MicrosoftTenant',
        targetId: 'tenant-1',
        metadata: { permissionVersion: REQUIRED_PERMISSION_VERSION },
      });
    });

    it('does not record microsoft_tenant.permission_consent_asserted when the assertion does not advance (already current — no duplicate/noisy audit entries)', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      mockedApplyConsentAssertion.mockResolvedValue({ advanced: false });

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(auditLog.record).not.toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ action: 'microsoft_tenant.permission_consent_asserted' }),
      );
    });

    it('re-verifies read permission via GraphConsentVerifierService for an existing tenant, and advances verifiedReadPermissionVersion on success', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      consentVerifier.verifyTenantConsent.mockResolvedValue(undefined);

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(consentVerifier.verifyTenantConsent).toHaveBeenCalledWith('entra-tenant-1');
      expect(mockedApplyVerifiedReadPermission).toHaveBeenCalledWith('tenant-1', REQUIRED_PERMISSION_VERSION);
    });

    it('re-verifies read permission for a provisioned-pending tenant too', async () => {
      mockedResolve.mockResolvedValue(resolution('provisioned-pending'));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(consentVerifier.verifyTenantConsent).toHaveBeenCalledWith('entra-tenant-1');
      expect(mockedApplyVerifiedReadPermission).toHaveBeenCalledWith('tenant-1', REQUIRED_PERMISSION_VERSION);
    });

    it('does not call the verifier again for a bootstrapped resolution (resolveOrProvisionFromConsent already just proved it) but still records verifiedReadPermissionVersion', async () => {
      mockedResolve.mockResolvedValue(resolution('bootstrapped'));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(consentVerifier.verifyTenantConsent).not.toHaveBeenCalled();
      expect(mockedApplyVerifiedReadPermission).toHaveBeenCalledWith('tenant-1', REQUIRED_PERMISSION_VERSION);
    });

    it('does NOT advance verifiedReadPermissionVersion when re-verification is definitively denied (ConsentVerificationError), and never fails the otherwise-successful sign-in', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      consentVerifier.verifyTenantConsent.mockRejectedValue(new ConsentVerificationError('denied'));

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(mockedApplyVerifiedReadPermission).not.toHaveBeenCalled();
      expect(result.kind).toBe('existing');
    });

    it('does NOT advance verifiedReadPermissionVersion when Graph is unavailable (an infrastructure error), and never fails the otherwise-successful sign-in', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      consentVerifier.verifyTenantConsent.mockRejectedValue(new Error('Graph is unreachable'));

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(mockedApplyVerifiedReadPermission).not.toHaveBeenCalled();
      expect(result.kind).toBe('existing');
    });

    it('never fails the sign-in even when applyVerifiedReadPermission itself rejects for a bootstrapped tenant', async () => {
      mockedResolve.mockResolvedValue(resolution('bootstrapped'));
      mockedApplyVerifiedReadPermission.mockRejectedValue(new Error('DB write failed'));

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(result.kind).toBe('bootstrapped');
    });

    it('critical separation: exactly one consent-assertion write and one read-permission write happen per callback, never duplicated across each other', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(mockedApplyConsentAssertion).toHaveBeenCalledTimes(1);
      expect(mockedApplyVerifiedReadPermission).toHaveBeenCalledTimes(1);
    });

    it('critical separation: consent assertion is recorded independently of whether read-permission verification succeeds or fails', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      consentVerifier.verifyTenantConsent.mockRejectedValue(new Error('Graph is unreachable'));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(mockedApplyConsentAssertion).toHaveBeenCalledWith('tenant-1', REQUIRED_PERMISSION_VERSION, expect.any(Date));
    });

    it("computes the response's needsReconsent from the tenant's final derived state, not from whether this request's own writes advanced anything", async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));
      mockedDerivePermissionReconsentState.mockReturnValue({
        needsReadReconsent: true,
        needsWriteConsentAssertion: false,
        needsReconsent: true,
      });

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(result).toMatchObject({ needsReconsent: true });
    });

    it('never exposes a state claiming Sites.ReadWrite.All (a write scope) has been independently verified', async () => {
      mockedResolve.mockResolvedValue(resolution('existing'));

      const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(result).not.toHaveProperty('writePermissionVerified');
      expect(result).not.toHaveProperty('sitesReadWriteAllVerified');
    });
  });
});
