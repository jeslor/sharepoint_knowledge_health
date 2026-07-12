/**
 * Every public function accepts this. correlationId is opaque to this
 * module (the worker passes its ScanJob.id, but this package has no idea
 * that's what it is — ADR-0013 §7) — a generic tracing primitive, never a
 * domain reference.
 */
export interface ListOptions {
  correlationId?: string;
}
