/**
 * The OAuth authorization-code exchange (admin-consent redirect -> code ->
 * token endpoint) is not implemented yet — that's OAuth-flow plumbing
 * distinct from token *verification*, and out of scope for this phase. This
 * endpoint expects the caller to have already obtained the resulting ID
 * token and hands it here for verification + ADR-0012 provisioning.
 */
export interface ConsentCallbackRequest {
  idToken: string;
  tenantName: string;
}
