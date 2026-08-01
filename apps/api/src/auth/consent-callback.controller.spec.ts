import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolveOrProvisionFromConsent, type ConsentResolution } from '@sph/database';
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

type RejectedReason = Extract<ConsentResolution, { kind: 'rejected' }>['reason'];

function resolution(kind: ConsentResolution['kind'], reason: RejectedReason = 'tenant-not-consented'): ConsentResolution {
  if (kind === 'rejected') return { kind, reason };
  return { kind, organizationId: 'org-1', microsoftTenantId: 'tenant-1', userId: 'user-1' };
}

describe('ConsentCallbackController', () => {
  const discoveryProducer = { enqueueDiscovery: jest.fn() };
  const auditLog = { record: jest.fn() } as unknown as jest.Mocked<AuditLogService>;
  const consentVerifier = {} as GraphConsentVerifierService;
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
    'throws ForbiddenException on a rejected resolution (reason: %s), without enqueueing discovery or recording an audit entry',
    async (reason) => {
      mockedResolve.mockResolvedValue(resolution('rejected', reason));

      await expect(controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' })).rejects.toThrow(ForbiddenException);
      expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
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
    expect(result).toEqual(resolution('bootstrapped'));
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
    'does not enqueue discovery or record an audit entry for kind: %s (not a fresh connection)',
    async (kind) => {
      mockedResolve.mockResolvedValue(resolution(kind));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    },
  );

  it('still returns the successful bootstrapped resolution even when enqueueing discovery fails', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));
    discoveryProducer.enqueueDiscovery.mockRejectedValue(new Error('Redis unavailable'));

    const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(result).toEqual(resolution('bootstrapped'));
    // The connection audit entry was already recorded before the
    // best-effort discovery enqueue was even attempted — a downstream
    // discovery failure must never retroactively un-log a connection that
    // genuinely happened.
    expect(auditLog.record).toHaveBeenCalledWith('org-1', expect.objectContaining({ action: 'microsoft_tenant.connected' }));
  });
});
