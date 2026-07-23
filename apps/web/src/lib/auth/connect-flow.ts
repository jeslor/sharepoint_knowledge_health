import { AUTHORITY } from './msal-config';

// Namespaced (sph:connect:*) to avoid any collision with MSAL's own
// sessionStorage keys (msal-config.ts: cacheLocation: 'sessionStorage').
// Both only ever need to survive the admin-consent redirect (Microsoft's
// raw /adminconsent endpoint and back) — read by
// admin-consent-callback/page.tsx on the very next page load, never past
// that point. Carrying the tenant name further, through the *subsequent*
// MSAL sign-in redirect, used to also go through TENANT_NAME_KEY here;
// that's now done via MSAL's own `state` parameter instead (msal-
// instance.ts's consumeLastLoginState()), which is why STATE_KEY no longer
// needs to double as an "is a flow in progress" marker past this page.
const STATE_KEY = 'sph:connect:state';
const TENANT_NAME_KEY = 'sph:connect:tenantName';

/**
 * Persists the org name + a fresh opaque `state` before navigating away to
 * Microsoft's admin-consent endpoint (a full page navigation — React state
 * does not survive it). Returns the generated `state` so the caller can
 * embed it in the admin-consent URL.
 */
export function startConnectFlow(tenantName: string): string {
  const state = generateOpaqueState();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(TENANT_NAME_KEY, tenantName);
  return state;
}

// crypto.randomUUID() isn't available in every environment this runs in
// (e.g. this project's jest/jsdom setup has crypto.getRandomValues but not
// randomUUID) — getRandomValues is the more broadly supported primitive,
// still cryptographically strong, which is what actually matters for an
// anti-replay OAuth `state` value.
function generateOpaqueState(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Browser-only, like every other function in this file — callers must only
// invoke this from an effect or event handler, never a component's render
// body (admin-consent-callback/page.tsx defers it to an effect specifically
// so this is never reached during Next.js's server render of that page).
export function validateConnectFlowState(candidateState: string): boolean {
  return sessionStorage.getItem(STATE_KEY) === candidateState;
}

export function readConnectFlowTenantName(): string | null {
  return sessionStorage.getItem(TENANT_NAME_KEY);
}

// Called only once the flow reaches a terminal outcome (success or
// rejected) — closes the replay window on this specific admin-consent
// state/tenant-name pair. app/page.tsx no longer depends on either key
// still being present by this point (it reads the tenant name back out of
// MSAL's own `state` parameter instead — see msal-instance.ts).
export function clearConnectFlow(): void {
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(TENANT_NAME_KEY);
}

/**
 * A new, dedicated redirect URI — deliberately not NEXT_PUBLIC_REDIRECT_URI
 * (MSAL's own sign-in redirect target), since this callback isn't
 * MSAL-mediated at all and must not collide with MsalProvider's
 * handleRedirectPromise() response shape.
 */
export function adminConsentRedirectUri(): string {
  const override = process.env.NEXT_PUBLIC_ADMIN_CONSENT_REDIRECT_URI;
  if (override) return override;
  if (typeof window === 'undefined') {
    throw new Error('adminConsentRedirectUri() can only be resolved in the browser');
  }
  return `${window.location.origin}/connect/admin-consent-callback`;
}

// Pure — easily unit-testable in isolation, per plan §8 Phase B.
export function buildAdminConsentUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state });
  return `${AUTHORITY}/adminconsent?${params.toString()}`;
}
