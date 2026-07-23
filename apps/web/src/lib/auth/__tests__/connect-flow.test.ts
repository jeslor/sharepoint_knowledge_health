import {
  buildAdminConsentUrl,
  clearConnectFlow,
  readConnectFlowTenantName,
  startConnectFlow,
  validateConnectFlowState,
} from '../connect-flow';

describe('connect-flow', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('buildAdminConsentUrl', () => {
    it('builds a well-formed Microsoft admin-consent URL against the organizations authority', () => {
      const url = buildAdminConsentUrl('client-1', 'https://app.example.com/connect/admin-consent-callback', 'state-1');
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe('https://login.microsoftonline.com/organizations/adminconsent');
      expect(parsed.searchParams.get('client_id')).toBe('client-1');
      expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/connect/admin-consent-callback');
      expect(parsed.searchParams.get('state')).toBe('state-1');
    });
  });

  describe('startConnectFlow / readConnectFlowTenantName', () => {
    it('has no tenant name before startConnectFlow is called', () => {
      expect(readConnectFlowTenantName()).toBeNull();
    });

    it('persists a fresh state and the tenant name', () => {
      const state = startConnectFlow('Acme Corporation');

      expect(state).toBeTruthy();
      expect(readConnectFlowTenantName()).toBe('Acme Corporation');
      expect(validateConnectFlowState(state)).toBe(true);
    });

    it('generates a distinct state on each call', () => {
      const first = startConnectFlow('Org A');
      const second = startConnectFlow('Org B');
      expect(first).not.toBe(second);
    });
  });

  describe('validateConnectFlowState', () => {
    it('rejects a state that does not match what was stored', () => {
      startConnectFlow('Acme Corporation');
      expect(validateConnectFlowState('not-the-real-state')).toBe(false);
    });

    it('rejects any state when nothing has been stored', () => {
      expect(validateConnectFlowState('anything')).toBe(false);
    });
  });

  describe('clearConnectFlow', () => {
    it('removes both keys', () => {
      startConnectFlow('Acme Corporation');
      clearConnectFlow();

      expect(readConnectFlowTenantName()).toBeNull();
    });
  });
});
