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

msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const result = event.payload as AuthenticationResult;
    if (result.account) {
      msalInstance.setActiveAccount(result.account);
    }
  }
});
