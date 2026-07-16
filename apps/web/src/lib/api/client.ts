export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function apiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not set — see apps/web/.env.example');
  }
  return base;
}

// Phase 7 (LAT F2): a default request timeout so the UI never waits
// indefinitely for a hung backend call (e.g. a Redis outage) — a default
// parameter, not a required one, so every existing call site is unaffected
// and inherits this without change. 20s is generous enough not to
// false-positive against docs/architecture/operations.md's already-
// documented large-tenant analytics latency risk, while still bounded.
const DEFAULT_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(
  path: string,
  token: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    // Translated into the same ApiError type every caller already knows
    // how to handle (e.g. connect/finishing/page.tsx's `instanceof
    // ApiError` check) — not a new error class, so no downstream call site
    // needs new handling logic. status: 0 follows the common convention of
    // "no real HTTP response was ever received."
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'Request timed out — please check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new ApiError(response.status, await safeErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(', ');
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall through.
  }
  return `Request failed with status ${response.status}`;
}
