export interface HealthStatus {
  readonly status: 'ok';
  readonly timestamp: string;
}

// Phase 9 (production hardening): distinct from HealthStatus (liveness —
// "is this process responsive at all," always 'ok' if it can answer).
// This is readiness — "can this instance actually serve traffic right
// now" — the standard split so a transient DB/Redis blip doesn't cause an
// orchestrator to kill and restart a process that a restart wouldn't fix.
export interface ReadinessStatus {
  readonly status: 'ok' | 'degraded';
  readonly timestamp: string;
  readonly checks: {
    readonly database: 'ok' | 'error';
    readonly redis: 'ok' | 'error';
  };
}
