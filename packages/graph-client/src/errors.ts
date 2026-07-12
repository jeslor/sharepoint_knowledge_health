// Graph/HTTP-shaped error hierarchy — deliberately only about failure mode,
// never about what the caller should do in response (ADR-0013 §5). Deciding
// "a permission error might mean revoked consent, update MicrosoftTenant"
// is the worker's business logic, not this module's.

export abstract class GraphClientError extends Error {
  constructor(
    message: string,
    readonly graphErrorCode?: string,
    readonly correlationId?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Token acquisition failed (bad/missing credential, misconfigured app). */
export class GraphAuthenticationError extends GraphClientError {}

/** 403 — permission missing or consent revoked. */
export class GraphPermissionError extends GraphClientError {}

/** 404 — site/drive/item deleted or moved. */
export class GraphNotFoundError extends GraphClientError {}

/** Retries exhausted after honoring Retry-After (429/503). */
export class GraphThrottledError extends GraphClientError {}

/** Network-level or 5xx failure, retries exhausted. */
export class GraphTransientError extends GraphClientError {}

/** Catch-all, preserves the fact that something unrecognized happened. */
export class GraphUnexpectedError extends GraphClientError {}

interface GraphErrorLike {
  statusCode?: number;
  code?: string;
  message?: string;
}

function isGraphErrorLike(error: unknown): error is GraphErrorLike {
  return typeof error === 'object' && error !== null && ('statusCode' in error || 'code' in error);
}

/** Maps a raw error from the Graph SDK (or MSAL) into this module's typed hierarchy. */
export function mapGraphError(error: unknown, correlationId?: string): GraphClientError {
  if (error instanceof GraphClientError) {
    return error;
  }

  if (!isGraphErrorLike(error)) {
    const message = error instanceof Error ? error.message : 'Unknown Graph client error';
    return new GraphUnexpectedError(message, undefined, correlationId);
  }

  const message = error.message ?? 'Graph request failed';
  const code = error.code;

  switch (error.statusCode) {
    case 401:
      return new GraphAuthenticationError(message, code, correlationId);
    case 403:
      return new GraphPermissionError(message, code, correlationId);
    case 404:
      return new GraphNotFoundError(message, code, correlationId);
    case 429:
    case 503:
      return new GraphThrottledError(message, code, correlationId);
    default:
      if (error.statusCode !== undefined && error.statusCode >= 500) {
        return new GraphTransientError(message, code, correlationId);
      }
      return new GraphUnexpectedError(message, code, correlationId);
  }
}
