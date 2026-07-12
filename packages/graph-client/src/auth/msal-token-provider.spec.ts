import { GraphAuthenticationError } from '../errors';

const mockAcquireTokenByClientCredential = jest.fn();

jest.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: jest.fn().mockImplementation(() => ({
    acquireTokenByClientCredential: mockAcquireTokenByClientCredential,
  })),
}));

import { getTokenForTenant, __resetMsalAppForTests } from './msal-token-provider';

describe('getTokenForTenant', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetMsalAppForTests();
    process.env = { ...originalEnv, ENTRA_CLIENT_ID: 'test-client-id', ENTRA_CLIENT_SECRET: 'test-secret' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('acquires a token scoped to the requested tenant, via a per-call authority override', async () => {
    mockAcquireTokenByClientCredential.mockResolvedValue({ accessToken: 'token-abc' });

    const token = await getTokenForTenant('tenant-123');

    expect(token).toBe('token-abc');
    expect(mockAcquireTokenByClientCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: ['https://graph.microsoft.com/.default'],
        authority: 'https://login.microsoftonline.com/tenant-123',
      }),
    );
  });

  it('throws GraphAuthenticationError when acquisition returns null', async () => {
    mockAcquireTokenByClientCredential.mockResolvedValue(null);
    await expect(getTokenForTenant('tenant-123')).rejects.toThrow(GraphAuthenticationError);
  });

  it('throws GraphAuthenticationError when required env vars are missing', async () => {
    delete process.env.ENTRA_CLIENT_SECRET;
    await expect(getTokenForTenant('tenant-123')).rejects.toThrow(GraphAuthenticationError);
  });

  it('reuses a single ConfidentialClientApplication instance across different tenants (ADR-0013 §2)', async () => {
    mockAcquireTokenByClientCredential.mockResolvedValue({ accessToken: 'token-1' });

    await getTokenForTenant('tenant-a');
    await getTokenForTenant('tenant-b');

    const msalModule = jest.requireMock('@azure/msal-node') as { ConfidentialClientApplication: jest.Mock };
    expect(msalModule.ConfidentialClientApplication).toHaveBeenCalledTimes(1);
  });
});
