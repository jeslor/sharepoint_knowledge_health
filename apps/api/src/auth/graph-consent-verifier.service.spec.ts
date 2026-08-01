import { ConsentVerificationError } from '@sph/database';
import { listSites, GraphPermissionError, GraphTransientError, type GraphSite } from '@sph/graph-client';
import { GraphConsentVerifierService } from './graph-consent-verifier.service';

jest.mock('@sph/graph-client');

const mockedListSites = listSites as jest.MockedFunction<typeof listSites>;

async function* asyncGen<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function* throwingAsyncGen(error: unknown): AsyncGenerator<GraphSite> {
  throw error;
}

describe('GraphConsentVerifierService', () => {
  const service = new GraphConsentVerifierService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves when listSites succeeds with results', async () => {
    mockedListSites.mockReturnValue(asyncGen([{ id: 'site-1', webUrl: 'https://contoso.sharepoint.com/sites/finance', displayName: 'Finance', isPersonalSite: false }]));

    await expect(service.verifyTenantConsent('entra-tenant-1')).resolves.toBeUndefined();
    expect(mockedListSites).toHaveBeenCalledWith('entra-tenant-1');
  });

  it('resolves when listSites succeeds with zero sites (genuinely empty tenant, not a permission problem)', async () => {
    mockedListSites.mockReturnValue(asyncGen([]));

    await expect(service.verifyTenantConsent('entra-tenant-1')).resolves.toBeUndefined();
  });

  it('throws ConsentVerificationError when listSites fails with a permission error (consent not granted)', async () => {
    mockedListSites.mockReturnValue(throwingAsyncGen(new GraphPermissionError('Access denied')));

    await expect(service.verifyTenantConsent('entra-tenant-1')).rejects.toThrow(ConsentVerificationError);
  });

  it('propagates a non-permission Graph error untouched (infrastructure failure, not a consent decision)', async () => {
    const transientError = new GraphTransientError('Graph unavailable');
    mockedListSites.mockReturnValue(throwingAsyncGen(transientError));

    await expect(service.verifyTenantConsent('entra-tenant-1')).rejects.toBe(transientError);
  });
});
