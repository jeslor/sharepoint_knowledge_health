import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { resolveOrProvisionFromConsent, type ConsentResolution } from '@sph/database';
import { verifyEntraToken } from './entra-jwt.guard';
import { ConsentCallbackController } from './consent-callback.controller';
import type { DiscoveryProducerService } from '../discovery/discovery-producer.service';

jest.mock('@sph/database');
jest.mock('./entra-jwt.guard', () => ({
  ...jest.requireActual('./entra-jwt.guard'),
  verifyEntraToken: jest.fn(),
}));

const mockedResolve = resolveOrProvisionFromConsent as jest.MockedFunction<typeof resolveOrProvisionFromConsent>;
const mockedVerify = verifyEntraToken as jest.MockedFunction<typeof verifyEntraToken>;

function resolution(kind: ConsentResolution['kind']): ConsentResolution {
  if (kind === 'rejected') return { kind, reason: 'tenant-not-consented' };
  return { kind, organizationId: 'org-1', microsoftTenantId: 'tenant-1', userId: 'user-1' };
}

describe('ConsentCallbackController', () => {
  const discoveryProducer = { enqueueDiscovery: jest.fn() };
  const controller = new ConsentCallbackController(discoveryProducer as unknown as DiscoveryProducerService);

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

  it('throws ForbiddenException on a rejected resolution, without enqueueing discovery', async () => {
    mockedResolve.mockResolvedValue(resolution('rejected'));

    await expect(controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' })).rejects.toThrow(ForbiddenException);
    expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
  });

  it('enqueues discovery when the resolution is bootstrapped (a MicrosoftTenant just transitioned to Consented)', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));

    const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(discoveryProducer.enqueueDiscovery).toHaveBeenCalledWith('org-1', 'tenant-1');
    expect(result).toEqual(resolution('bootstrapped'));
  });

  it.each(['existing', 'provisioned-pending'] as const)(
    'does not enqueue discovery for kind: %s (not a fresh consent transition)',
    async (kind) => {
      mockedResolve.mockResolvedValue(resolution(kind));

      await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

      expect(discoveryProducer.enqueueDiscovery).not.toHaveBeenCalled();
    },
  );

  it('still returns the successful bootstrapped resolution even when enqueueing discovery fails', async () => {
    mockedResolve.mockResolvedValue(resolution('bootstrapped'));
    discoveryProducer.enqueueDiscovery.mockRejectedValue(new Error('Redis unavailable'));

    const result = await controller.handleConsentCallback({ idToken: 'token', tenantName: 'Acme' });

    expect(result).toEqual(resolution('bootstrapped'));
  });
});
