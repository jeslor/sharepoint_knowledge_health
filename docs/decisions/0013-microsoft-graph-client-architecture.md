# ADR-0013: Microsoft Graph Client Architecture

Date: 2026-07-12
Status: Accepted

---

## Problem

ADR-0003 decided *which* Graph permissions we use (app-only, `Files.Read.All`/`Sites.Read.All`, read-only), and ADR-0009 decided *where* the Graph integration lives (`packages/graph-client`, consumed by `apps/api` and `apps/worker`) — but nothing decides how the module actually authenticates, paginates, retries, or shapes its output. This ADR defines that complete internal architecture, validated against the current, real APIs of the libraries involved (not assumed) — several of the assumptions this ADR started from were factually wrong and are corrected explicitly below.

## Context

- Enterprise SaaS, one multi-tenant Entra app registration, many customer Azure AD tenants (ADR-0003 addendum).
- `MicrosoftTenant.entraTenantId` (ADR-0007) is how a customer's Azure AD tenant is identified in our system — but this module must not know about `MicrosoftTenant` the Prisma model, only the raw `entraTenantId` string.
- Consumed by both `apps/api` (lightweight, request-scoped lookups) and `apps/worker` (long-running scans over potentially very large SharePoint sites — must not buffer full result sets into memory).
- Node 20, TypeScript strict, no `any`, matching the rest of the monorepo.

---

## Decision

### 1. Graph SDK selection

**Use the official `@microsoft/microsoft-graph-client` (v3.0.7), not hand-rolled REST calls.** It ships its own TypeScript types (no `@types/*` package needed) and — critically — its default middleware chain includes retry/throttling behavior that already matches Microsoft's own documented guidance almost exactly (see §5). Reimplementing that correctly by hand is real, security/reliability-sensitive work with no upside over the SDK doing it for us.

### 2. MSAL Node for app-only authentication, client credentials flow, per-tenant token acquisition, and caching

**Use `@azure/msal-node` (v5.4.0), `ConfidentialClientApplication`, client-credentials flow, scopes `['https://graph.microsoft.com/.default']`** — the standard app-only pattern.

**Corrected design — a single shared instance, not one per tenant.** The starting assumption for this ADR was that a multi-tenant, one-app-registration setup would need a `ConfidentialClientApplication` instance per customer tenant. That's wrong. MSAL's `authority` (which embeds the tenant) is **not fixed at construction** for `acquireTokenByClientCredential` — it can be overridden per call, and this is MSAL's own documented, intended mechanism for exactly this scenario:

```typescript
// Constructed ONCE, at module load — not per tenant.
const msalApp = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.ENTRA_CLIENT_ID,
    clientSecret: process.env.ENTRA_CLIENT_SECRET, // Key Vault-backed in prod, per ADR-0006
    authority: 'https://login.microsoftonline.com/organizations',
  },
});

// Tenant supplied per call, not per instance.
async function getTokenForTenant(entraTenantId: string): Promise<string> {
  const result = await msalApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
    authority: `https://login.microsoftonline.com/${entraTenantId}`,
  });
  if (!result) throw new GraphAuthenticationError('Token acquisition returned null');
  return result.accessToken;
}
```

**Token caching: MSAL's built-in in-memory cache, no external cache needed.** Confirmed from source: `ConfidentialClientApplication` maintains one in-memory `NodeStorage` for its whole lifetime, and its cache key includes the *resolved tenant* (`realm`), not the authority string used to request it — meaning the single shared instance above correctly caches tokens **per tenant**, with no risk of cross-tenant collision, and no redundant network calls for repeated acquisitions within a token's lifetime. No Redis or external cache is required for correctness. The only thing an external cache would buy is avoiding each `apps/worker` replica independently warming its own cache after a restart/scale-up — a minor efficiency concern, not a correctness one, and explicitly deferred (see Future Considerations).

### 3. Retry policy and respecting `Retry-After`

**Use the SDK's built-in `RetryHandler` middleware as-is, with default settings, for MVP.** Correction: there is no separate "`ThrottleHandler`" in the current SDK — retry-on-throttle and `Retry-After` handling are unified in one `RetryHandler`, already part of the default middleware chain (`AuthenticationHandler → RetryHandler → RedirectHandler → TelemetryHandler → HTTPMessageHandler`) that `Client.init()` builds automatically. Confirmed behavior:

- Retries on **429, 503, 504**.
- Honors `Retry-After` automatically, no configuration needed (Graph's own docs confirm it's returned as a plain integer number of seconds; the SDK also defensively handles an HTTP-date form).
- Falls back to exponential backoff + jitter when no `Retry-After` header is present.
- Defaults: 3 retries, 3s base delay, 180s max delay cap (configurable via `RetryHandlerOptions` if MVP defaults prove insufficient — no reason to override them upfront; they already match Microsoft's own documented throttling guidance almost exactly).

Microsoft's Graph throttling guidance (verified current) explicitly recommends *not* retrying immediately and always honoring `Retry-After` when present — exactly what the default `RetryHandler` already does. One caveat worth documenting now for later: if `$batch` requests are ever adopted, throttled sub-responses inside a batch are **not** auto-retried by this middleware — each sub-response would need individual inspection. Not a concern for MVP's non-batched calls.

### 4. Pagination strategy — async generator, not the SDK's `PageIterator`

**Do not use `PageIterator`.** It exists in the SDK, but it's strictly callback-based (`(item) => boolean`, driven by a single non-reentrant `iterate()` call) with no native `Symbol.asyncIterator` support — it provides no real backpressure, since it runs pages through as fast as they arrive regardless of how fast the consumer processes them. That's a direct conflict with the requirement to avoid loading everything into memory for a worker processing very large sites.

**Instead: a hand-rolled async generator that follows `@odata.nextLink`.** This is not a workaround — Microsoft's own `PageIterator` is itself a thin wrapper around exactly this loop; hand-rolling it as a native generator just gets us idiomatic `for await...of` consumption with real backpressure (the next page is only fetched when the consumer pulls the next value):

```typescript
async function* paginate<T>(client: Client, initialUrl: string): AsyncGenerator<T> {
  let url: string | undefined = initialUrl;
  while (url) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await client.api(url).get();
    yield* page.value;
    url = page['@odata.nextLink'];
  }
}
```

Every collection-returning public function in this module (`listSites`, `listDrives`, `listDocuments`) returns `AsyncGenerator<GraphDto>` built on top of this, never a materialized array.

### 5. Structured error hierarchy

A small, Graph/HTTP-shaped error hierarchy — deliberately **only about failure mode, never about what the caller should do in response** (that's the worker's business logic, not this module's):

```typescript
abstract class GraphClientError extends Error {
  constructor(message: string, readonly graphErrorCode?: string, readonly correlationId?: string) { super(message); }
}

class GraphAuthenticationError extends GraphClientError {}   // token acquisition failed
class GraphPermissionError extends GraphClientError {}       // 403 — consent missing/revoked
class GraphNotFoundError extends GraphClientError {}         // 404 — site/item deleted or moved
class GraphThrottledError extends GraphClientError {}        // retries exhausted after honoring Retry-After
class GraphTransientError extends GraphClientError {}        // network/5xx, retries exhausted
class GraphUnexpectedError extends GraphClientError {}       // catch-all, preserves original error
```

Mapped from Graph's own documented error response shape (`{ error: { code, message, innerError } }`). `GraphPermissionError` deliberately carries only the raw Graph signal (tenant ID string, Graph error code) — it does **not** reference `MicrosoftTenant` or its `status` enum. Deciding "a permission error means this tenant's consent may have been revoked, update `MicrosoftTenant.status`" is the worker's job, reacting to the error *type* this module surfaces — the boundary this ADR exists to protect.

### 6. Separation between Graph DTOs and domain models

**This module exports only Graph-shaped DTOs — never anything resembling a Prisma model.** DTO field names and shapes stay close to Graph's actual API response shapes (its own camelCase field names), deliberately *not* renamed to match our schema:

```typescript
interface GraphSite {
  id: string;
  webUrl: string;
  displayName: string;
}

interface GraphDrive {
  id: string;
  name: string;
  webUrl: string;
  driveType: string; // Graph's own field, e.g. "documentLibrary"
}

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl: string;
  size: number;
  createdDateTime: string;
  lastModifiedDateTime: string;
  file?: { mimeType: string };
  parentReference: { driveId: string; siteId?: string };
}
```

Mapping `GraphDriveItem.lastModifiedDateTime` → `Document.sourceModifiedAt`, `GraphDriveItem.size` → `Document.sizeBytes` (including the `number` → `BigInt` conversion), `GraphDriveItem.id` → `Document.graphItemId`, etc., happens **only** in `apps/worker`, which is the one place both `packages/graph-client` and `packages/database` are legitimately imported together. This is the direct, literal implementation of "the Worker will map Graph DTOs into domain models."

### 7. Logging and observability

`packages/graph-client` does not depend on NestJS (keeps it consumable by any future non-Nest context, and matches `packages/database`'s existing framework-agnostic design). It accepts a minimal, injectable logger interface:

```typescript
interface GraphClientLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

Defaults to a no-op logger if none is supplied. Every public call accepts an optional `correlationId: string` (opaque to this module — the worker passes its `ScanJob.id`, but the module has no idea that's what it is, preserving the "must never know about" boundary) that gets attached to every log line for that call, so retries/throttle-waits/token-acquisitions can be traced back to the scan that triggered them. **Never logs tokens, secrets, or full request/response bodies** — only status codes, retry counts, wait durations, and the correlation ID, consistent with `security.md`'s "never log credentials."

### 8. Public interfaces exposed by `packages/graph-client`

Every public function is keyed by the raw `entraTenantId: string` — never `organizationId` or a `MicrosoftTenant` reference. The caller (always `apps/api` or `apps/worker`, both of which *do* know about `MicrosoftTenant`) resolves that string from the database first and passes it in as a plain value. The surface mirrors Graph's own resource hierarchy (site → drive → item) rather than jumping straight from "site" to "items," so the module is complete enough to be genuinely reusable, not just sufficient for this product's specific call pattern (see §9):

```typescript
interface ListOptions {
  correlationId?: string;
}

function listSites(entraTenantId: string, options?: ListOptions & { search?: string }): AsyncGenerator<GraphSite>;
function getSite(entraTenantId: string, siteId: string, options?: ListOptions): Promise<GraphSite>;

function listDrives(entraTenantId: string, siteId: string, options?: ListOptions): AsyncGenerator<GraphDrive>;
function getDrive(entraTenantId: string, driveId: string, options?: ListOptions): Promise<GraphDrive>;

function listDocuments(entraTenantId: string, driveId: string, options?: ListOptions): AsyncGenerator<GraphDriveItem>;
function getDocument(entraTenantId: string, driveId: string, itemId: string, options?: ListOptions): Promise<GraphDriveItem>;
```

No `create`/`update`/`delete` functions exist anywhere in this module's surface — read-only is enforced by the public API shape itself, not just by the granted Graph permissions.

### 9. Reusable, product-independent public API

**`packages/graph-client`'s public API must be completely independent of SharePoint Knowledge Health as a product.** It should read like a general-purpose Microsoft Graph SDK wrapper that any application needing app-only, multi-tenant Graph access could use — not a module shaped around our specific scan pipeline. Concretely:

- **Every method name and signature must be describable without reference to this product.** `listSites()`, `listDrives()`, `listDocuments()`, `getSite()` are all correct — a reader with zero context on SharePoint Knowledge Health would understand exactly what each one does from Graph's own vocabulary alone.
- **It must never expose a method shaped around our business process** — `scanOrganization()`, `calculateHealth()`, `saveDocuments()` (or anything resembling them) are explicitly forbidden. Those names encode *our* workflow (scanning, scoring, persisting) onto a module that should have no concept that a "scan" or a "health score" exists. That logic belongs entirely in `apps/worker`, which is free to call `listSites()` → `listDrives()` → `listDocuments()` in whatever sequence its own scan pipeline needs, without the Graph module knowing or caring that a "scan" is what's happening.
- This is not a new constraint so much as the sharpest possible test of §6/the Architectural rule below: **if a method name or parameter would be impossible to justify in a standalone, product-agnostic Graph SDK, it doesn't belong in this module.** A generically reusable API and a business-logic-free API are the same requirement, viewed from two different angles — the reusability framing is often the easier one to check a proposed method name against in review.
- Practical consequence: nothing in this module should ever accept or return an `organizationId`, a `ScanJob`, a `HealthScore`, or any other domain concept — not even as an optional/unused parameter "for future convenience." If a future need arises to correlate Graph calls with a scan, that's what the already-designed opaque `correlationId: string` (§7) is for — a generic tracing primitive, not a domain reference.

### Architectural rule: what this module must never know about

`packages/graph-client` must never import or reference: `@prisma/client`, `@sph/database`, `bullmq`, `Organization`, `HealthScore`, or any business rule (scoring, scan-triggering, persistence decisions). It receives plain strings (`entraTenantId`, `siteId`) and returns plain Graph-shaped DTOs and typed errors — nothing else. Combined with §9, this is a two-sided guarantee: the *imports* rule stops it from depending on our infrastructure, and the *API shape* rule stops it from encoding our workflow — either one slipping would defeat the other's purpose. This is what makes it independently testable (no DB/queue infrastructure needed to test it) and keeps `apps/worker` as the only place Graph data and domain data ever meet. Enforce the imports rule the same way every other layering boundary in this project has been enforced (ADR-0009, Phase 1/3's `no-restricted-imports` rules) — via an ESLint rule in `packages/graph-client`'s own config banning imports of `@prisma/client`, `@sph/database`, and `bullmq`. Enforce the API-shape rule (§9) via code review against the "would this make sense in a standalone SDK" test — it's a naming/design discipline, not something a lint rule can catch. (Neither implemented in this ADR, per your instruction — described here as the required enforcement mechanisms for whoever implements it.)

---

## Tradeoffs

- Hand-rolling pagination instead of using `PageIterator` is a small amount of extra code (a ~10-line generator) in exchange for real backpressure and idiomatic `for await` consumption — a clear win given the "must not load everything into memory" requirement, not a compromise.
- Relying on the SDK's default `RetryHandler` settings (3 retries, 3s/180s delay bounds) means accepting Microsoft's own tuning rather than customizing upfront — appropriate for MVP; revisit only if real scan telemetry shows it's wrong, not preemptively.
- No external/shared token cache means each `apps/worker` replica independently acquires and caches tokens per tenant after a cold start — a minor efficiency cost, not a correctness one (MSAL's per-instance cache already prevents redundant calls *within* a replica's lifetime).
- The strict DTO/domain separation means every field mapping is hand-written in the worker rather than auto-derived — more boilerplate, but it's the only way to keep this module honestly ignorant of our schema, which is the whole point of the rule.
- Exposing the full site → drive → document hierarchy (rather than collapsing straight to "give me a site's documents") is a slightly larger public API surface than this product's own scan pipeline strictly needs today — accepted deliberately, since a truncated surface is exactly what would make the module *not* genuinely reusable (§9).

## Future Considerations

- If cross-replica token-cache warming becomes a measurable cost, `msal-node-extensions` (or a custom `ICachePlugin`) can back MSAL's cache with Redis — additive, not a redesign, since the public interface above doesn't change either way.
- Delta query support (ADR-0004's already-deferred v2 item) fits naturally into the pagination layer later — `PageIterator`'s `getDeltaLink()` isn't used today, but nothing here forecloses adding a parallel `deltaLink`-aware generator when that work starts.
- If `$batch` is ever adopted for efficiency, the retry story for individual sub-responses inside a batch needs explicit handling — flagged now so it isn't rediscovered as a surprise later.
- Site discovery policy (ADR-0014) determines what `listSites`/`listDrives`/`listDocuments` actually get called with and how their results are used to populate `SharePointSite` — this ADR only defines the mechanism, not the policy.
- If `packages/graph-client` proves genuinely reusable beyond this product (per §9), extracting it into a standalone published package becomes a realistic option later — the design choices in this ADR (no product imports, no product-shaped method names) are what keep that door open without any rework.
