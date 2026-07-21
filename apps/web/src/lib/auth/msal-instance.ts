import { PublicClientApplication, EventType, type AuthenticationResult } from '@azure/msal-browser';
import { msalConfig } from './msal-config';

/**
 * Module-scoped singleton — msal-browser is stateful (holds the token
 * cache) and must not be reconstructed per component.
 *
 * Initialization and redirect-promise handling are deliberately NOT done
 * here. @azure/msal-react's <MsalProvider> already does both internally,
 * inside its own useEffect (confirmed by reading
 * node_modules/@azure/msal-react/dist/MsalProvider.js directly), and drives
 * the inProgress state machine (Startup → HandleRedirect → None) that
 * <AuthenticatedTemplate>/<UnauthenticatedTemplate> already correctly gate
 * on (confirmed by reading UnauthenticatedTemplate.js — it checks
 * `inProgress !== Startup && inProgress !== HandleRedirect` before
 * rendering, so it won't flash the wrong template during redirect
 * processing). Calling initialize()/handleRedirectPromise() a second time
 * here would violate "initialize exactly once" and can cause MsalProvider's
 * own account/event tracking to miss the login result entirely, since the
 * redirect response is single-use.
 */
export const msalInstance = new PublicClientApplication(msalConfig);

// Standard Microsoft sample pattern: default to the first cached account on
// load if none is active yet, and keep the active account in sync on every
// successful login. Safe to register/call immediately — addEventCallback
// and getAllAccounts() don't require initialize() to have completed first
// (confirmed via msal-browser's UnknownOperatingContextController, the
// pre-initialize stub controller: getAllAccounts() returns [] rather than
// throwing before initialize() resolves).
if (!msalInstance.getActiveAccount() && msalInstance.getAllAccounts().length > 0) {
  const [firstAccount] = msalInstance.getAllAccounts();
  if (firstAccount) {
    msalInstance.setActiveAccount(firstAccount);
  }
}

/**
 * Root cause fix (2026-07-22): the onboarding flow previously carried the
 * tenant name across the sign-in redirect via a custom sessionStorage key
 * (sph:connect:tenantName), on the assumption that sessionStorage reliably
 * survives a full top-level round trip through login.microsoftonline.com
 * and back. Extensive live testing showed this specific hop — not the
 * earlier admin-consent redirect, which reliably validates every time —
 * losing that value intermittently, with no reproducible single cause
 * found (browser storage-partitioning heuristics around cross-origin
 * "bounce" navigations are the leading suspect, but the point is this
 * mechanism itself is inherently fragile for this hop, not any one bug in
 * it). Replaced with the OAuth `state` parameter itself: admin-consent-
 * callback/page.tsx now passes the tenant name as loginRedirect's own
 * `state` option, which login.microsoftonline.com round-trips as part of
 * the protocol response, not as separate client storage. This capture
 * lives in memory only (not sessionStorage) since it only needs to survive
 * from this event firing to app/page.tsx's effect reading it a moment
 * later on the same page load — a far shorter, same-page window than a
 * full cross-origin redirect.
 */
let lastLoginState: string | null = null;

// Mutating read, by design — clears on consumption so a value is never
// accidentally reused. Callers MUST guard against calling this more than
// once per real login event (app/page.tsx does this via a useRef — React
// 18 Strict Mode's dev-only double-effect-invocation would otherwise call
// this twice per mount, and the second call would always see null
// regardless of what actually happened; confirmed via an isolated
// StrictMode-wrapped test of app/page.tsx during this investigation).
export function consumeLastLoginState(): string | null {
  const value = lastLoginState;
  lastLoginState = null;
  return value;
}

msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const result = event.payload as AuthenticationResult;
    if (result.account) {
      msalInstance.setActiveAccount(result.account);
    }
    lastLoginState = result.state ?? null;
  }
});
