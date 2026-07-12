// No NestJS dependency (ADR-0013 §7) — keeps this package consumable by any
// future non-Nest context, matching packages/database's framework-agnostic
// design. Never log tokens, secrets, or full request/response bodies.
export interface GraphClientLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: GraphClientLogger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
