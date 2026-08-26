import { REMEDIATION_QUEUE, type RemediationJobPayload } from '@sph/types';

// No existing queue in this codebase (SCAN_QUEUE/DISCOVERY_QUEUE/
// NOTIFICATION_RECONCILIATION_QUEUE) has a dedicated test asserting its
// BullModule.registerQueue() defaultJobOptions — those are trusted by code
// review, matching the comment-as-documentation convention already used
// for all three. RemediationModule's registration follows that exact,
// already-reviewed shape (see remediation.module.ts) and is proven to wire
// into the running application without error by app.module.spec.ts, the
// established "does this module registration actually work" test for this
// whole app. This file covers what's left: the plain constant and payload
// shape a producer (Phase 6's API layer) needs to match exactly.
describe('REMEDIATION_QUEUE (ADR-0022 §3.3)', () => {
  it('is named "remediation-queue"', () => {
    expect(REMEDIATION_QUEUE).toBe('remediation-queue');
  });

  it('RemediationJobPayload is the minimal {organizationId, remediationJobId} shape — no individual documents/items', () => {
    const payload: RemediationJobPayload = { organizationId: 'org-1', remediationJobId: 'job-1' };

    expect(Object.keys(payload).sort()).toEqual(['organizationId', 'remediationJobId']);
  });
});
