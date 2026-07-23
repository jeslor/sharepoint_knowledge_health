import type { Configuration, RedirectRequest } from '@azure/msal-browser';

// Work/school accounts only — matches apps/api's entra-jwt.guard.ts, which
// fetches its JWKS from this exact same /organizations/ authority path, not
// /common (which would also accept personal Microsoft accounts, outside
// this product's account model).
export const AUTHORITY = 'https://login.microsoftonline.com/organizations';

export function requireClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID;
  if (!clientId) {
    throw new Error('NEXT_PUBLIC_ENTRA_CLIENT_ID is not set — see apps/web/.env.example');
  }
  return clientId;
}

// A single, fixed, absolute redirect URI — not msal-browser's own default
// (the current page's full URL), which would require registering every
// dashboard route individually in the Entra App Registration. This exact
// value (the app's origin) is what must be registered there, under the
// app registration's "Single-page application" platform — not "Web".
function defaultRedirectUri(): string | undefined {
  return typeof window !== 'undefined' ? window.location.origin : undefined;
}

export const msalConfig: Configuration = {
  auth: {
    clientId: requireClientId(),
    authority: AUTHORITY,
    redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI ?? defaultRedirectUri(),
    // The "Connect Microsoft 365" flow calls loginRedirect() from
    // /connect/admin-consent-callback, not from redirectUri itself. MSAL's
    // default (true) would navigate the browser back to that originating
    // page once the redirect response is processed, undoing the whole
    // point of a fixed redirectUri: app/page.tsx's effect (which reads
    // consumeLastLoginState() and routes to /connect/finishing) never gets
    // a chance to run, and the user lands back on the admin-consent-
    // callback screen with its button, as if nothing happened. false keeps
    // the browser on redirectUri, where that routing logic actually lives.
    navigateToLoginRequestUrl: false,
  },
  cache: {
    // MSAL's own recommended default, set explicitly rather than left
    // implicit — never localStorage (survives tab close, larger XSS blast
    // radius; sessionStorage clears with the tab and is what Microsoft's
    // own guidance recommends for SPAs).
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// No Graph permissions requested from the frontend at all (least
// privilege) — apps/api's EntraJwtGuard validates an ID token (audience =
// our own app), not a Graph access token, so `openid profile` is all that's
// needed to get one back from MSAL.
export const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile'],
};
