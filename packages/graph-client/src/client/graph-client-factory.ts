import { Client } from '@microsoft/microsoft-graph-client';
import { getTokenForTenant } from '../auth/msal-token-provider';

/**
 * Client.init({ authProvider }) — the SDK's sanctioned extension point for
 * a custom token source (ADR-0013 §1/§2). The default middleware chain
 * (retry/throttle handling, ADR-0013 §3) is preserved; only authentication
 * is customized. authProvider here is the callback-style AuthProvider
 * signature the SDK's current TypeScript types actually require for
 * Client.init() — confirmed against the compiler, not assumed.
 */
export function createGraphClient(entraTenantId: string): Client {
  return Client.init({
    authProvider: (done) => {
      getTokenForTenant(entraTenantId)
        .then((token) => done(null, token))
        .catch((error: unknown) => done(error, null));
    },
  });
}
