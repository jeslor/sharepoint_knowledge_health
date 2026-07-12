import { ConfidentialClientApplication } from '@azure/msal-node';
import { GraphAuthenticationError } from '../errors';

const GRAPH_DEFAULT_SCOPE = 'https://graph.microsoft.com/.default';

let msalApp: ConfidentialClientApplication | undefined;

/**
 * Lazily constructed, module-scoped singleton — NOT one instance per
 * tenant. Deferred (rather than built at import time) so importing this
 * package doesn't crash contexts where ENTRA_CLIENT_ID/SECRET aren't set
 * but Graph calls are never actually made (e.g. typecheck, unrelated tests).
 */
function getMsalApp(): ConfidentialClientApplication {
  if (!msalApp) {
    const clientId = process.env.ENTRA_CLIENT_ID;
    const clientSecret = process.env.ENTRA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new GraphAuthenticationError('ENTRA_CLIENT_ID/ENTRA_CLIENT_SECRET are not configured');
    }
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: 'https://login.microsoftonline.com/organizations',
      },
    });
  }
  return msalApp;
}

/**
 * ADR-0013 §2: MSAL's authority is overridable per-call (not fixed at
 * construction), and its built-in in-memory cache correctly partitions by
 * resolved tenant — so a single shared ConfidentialClientApplication
 * safely and efficiently serves every customer tenant, with no external
 * cache required for correctness.
 */
export async function getTokenForTenant(entraTenantId: string): Promise<string> {
  const app = getMsalApp();

  let result;
  try {
    result = await app.acquireTokenByClientCredential({
      scopes: [GRAPH_DEFAULT_SCOPE],
      authority: `https://login.microsoftonline.com/${entraTenantId}`,
    });
  } catch (error) {
    throw new GraphAuthenticationError(error instanceof Error ? error.message : 'Token acquisition failed');
  }

  if (!result) {
    throw new GraphAuthenticationError('Token acquisition returned null');
  }

  return result.accessToken;
}

/** Test-only escape hatch to reset the singleton between test cases. */
export function __resetMsalAppForTests(): void {
  msalApp = undefined;
}
