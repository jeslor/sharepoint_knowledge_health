# ADR-0018: First-Scan Experience Within Onboarding

Date: 2026-07-20
Status: Accepted

---

## Problem

ADR-0015 §5 already gave the worker the ability to report live per-site scan progress (`ScanJob.totalSites`/`sitesCompleted`/`currentSiteName`) and the dashboard already polls it every 5 seconds while a scan is active — but nothing about *onboarding* uses this today. A first-time customer, having just connected Microsoft 365, approved sites, and configured a schedule, still hits a plain "Start scan" button and a generic spinner, with no indication of progress and no distinct moment marking "this organization has now produced its first real result." A product/UX design review this session identified this as a real gap against the "time to first value" bar enterprise-monitoring products (Datadog, Defender for Cloud) are judged on, and this ADR is the architectural decision for closing it — reusing existing scan infrastructure, not building a second one.

## Context

- `ScanJob` already has `status`, `totalSites`, `sitesCompleted`, `currentSiteName` (ADR-0015 §5, Phase 7A) — the data this ADR needs already exists and is already written by `DocumentCollectorProcessor`'s existing per-site loop.
- `GET /organizations/:id/scans/:scanId` already returns these fields — no new endpoint needed to read progress.
- ADR-0017's `onboarding-status` endpoint already exposes `firstScanCompleted: boolean`, derived from "any `ScanJob` for the org has `status: Completed`."

## Decision

### 1. How onboarding knows "first value" has been reached

**`firstScanCompleted` (ADR-0017) is the single source of truth for "has this organization ever seen a result."** It is computed the same way every other onboarding-status field is — a direct query (`any ScanJob where organizationId = X and status = Completed`), not a stored flag. The moment this flips from `false` to `true` (observed by the frontend re-fetching `onboarding-status` after a scan completes) is the trigger for the one-time "first Health Score reveal" framing described below. There is no separate "isFirstScan" marker on `ScanJob` itself — a `ScanJob` doesn't need to know whether it's an organization's first or fiftieth; "firstness" is a property of the *sequence*, computed by counting, exactly matching this project's existing `HealthSnapshot`-immutability-enables-counting precedent (ADR-0015 Phase 7C: "`totalCompletedScans` is simply `points.length`, valid precisely because of the immutability invariant").

### 2. How scan progress is surfaced during onboarding

**Reused, not rebuilt.** The onboarding "Run first scan" step polls the same existing `GET /organizations/:id/scans/:scanId` endpoint the general scan-detail page already polls, rendering `totalSites`/`sitesCompleted`/`currentSiteName` in an onboarding-appropriate layout (existing design-system primitives only — no new polling mechanism, no new backend field). The only thing genuinely new is *where* this is shown (inline in the onboarding checklist, framed as "Scanning your SharePoint environment for the first time…") — not a new capability.

### 3. The first-reveal framing

The first time `onboarding-status.firstScanCompleted` transitions to `true` within a session, the dashboard renders one additional, brief explanatory moment alongside the Health Score that never repeats on subsequent visits — a short sentence establishing what the number means and which `HealthBand` (ADR-0002) it falls into. This is presentational only: it reads the same `HealthSummaryResponse` the dashboard already fetches, and is gated purely on the transition observed via `onboarding-status`, not a new stored "has this user seen their first score" preference.

## Acceptance Criteria

- No new `ScanJob` field, no new scan-progress endpoint — verified by this phase introducing zero schema and zero new API routes beyond what ADR-0017 already defines.
- The onboarding scan-progress view and the existing `/dashboard/scans/:scanId` progress display consume the identical endpoint and field set — a change to one's underlying data is guaranteed visible to the other, since there is only one implementation.
- `firstScanCompleted`'s transition from `false` to `true` is observable purely by re-fetching `onboarding-status` after a scan completes — no scan-completion webhook, push channel, or new event needed for this phase (polling, matching the existing scan-progress pattern, is sufficient).

## Tradeoffs

- Polling (not push) for both scan progress and the first-reveal transition means a small latency between "the scan actually finished" and "the UI notices" — identical to the existing, already-accepted latency in the general scan-detail page's own 5-second poll, not a new characteristic.
- The first-reveal moment is a client-observed transition, not a durable server-side marker — if a customer's browser crashes exactly between the transition and the reveal rendering, they simply see the ordinary (non-first-reveal) dashboard on their next visit. Accepted: the *data* (the Health Score itself) is never lost, only a one-time explanatory framing, which is a low-stakes thing to occasionally miss.

## Future Considerations

- If a genuine push-based notification system is ever built (the `NOTIFICATION_QUEUE` stub named in ADR-0015 §6, still unimplemented as of this ADR), scan-completion notification and this ADR's first-reveal trigger are natural, shared consumers of the same event — not solved here, named so it isn't rediscovered as a surprise.
- A durable "has this organization seen its first-reveal moment" marker could replace the purely client-observed transition above if the polling-based approach proves too fragile in practice — deliberately not built preemptively.
