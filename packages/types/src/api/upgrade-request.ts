// Phase 6: the human-assisted "request an upgrade" workflow — deliberately
// not a billing/subscription contract. See usage.ts's own header for the
// same "reporting, not enforcement" framing this shares.

export interface RequestUpgradeRequest {
  // Optional, user-supplied, length-validated server-side
  // (upgrade-request.controller.ts) — never trusted beyond that. Every
  // other field the resulting email/record needs (organization, plan,
  // usage, requester identity) is derived server-side from the
  // authenticated session/tenant context, never accepted from the client.
  message?: string;
}

export type UpgradeRequestStatusValue = 'Pending' | 'Contacted' | 'Completed';

export interface RequestUpgradeResponse {
  id: string;
  status: UpgradeRequestStatusValue;
  createdAt: string;
}
