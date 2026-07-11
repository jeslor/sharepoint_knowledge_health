Browser
  ↓
apps/web (Next.js) — Azure Container App
  ↓ REST API calls only
apps/api (NestJS) — Azure Container App
  ↓ creates ScanJob, enqueues via Redis (BullMQ)        ↘ reads/writes via packages/database (Prisma)
Redis (Azure Cache for Redis)                             PostgreSQL (Azure Database for PostgreSQL)
  ↓ consumed by
apps/worker (NestJS + BullMQ) — Azure Container App, no public HTTP endpoint
  ↓ reads/writes via packages/database                    ↓ via packages/graph-client
PostgreSQL                                                 Microsoft Graph API
                                                              ↓
                                                            SharePoint

apps/web, apps/api, and apps/worker are independently deployed apps within one Azure Container Apps
Environment, each with its own Dockerfile and deployment lifecycle, sharing TypeScript packages
(types, config, database, graph-client) from a single monorepo. See ADR-0006 and ADR-0009.
