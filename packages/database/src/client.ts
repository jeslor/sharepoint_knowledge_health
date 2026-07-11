import { PrismaClient } from '@prisma/client';

declare global {
  var __prismaClient: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

// Reuse a single PrismaClient across hot-module-reload cycles in dev so we
// don't exhaust the Postgres connection pool with a new client per reload.
//
// INTERNAL ONLY — not exported from index.ts. Every application must go
// through createTenantContext() (tenant-context.ts) or the sanctioned
// unscoped identity lookup (identity.ts). This is the actual enforcement
// mechanism for ADR-0001: if apps/api or apps/worker cannot import this
// module, they cannot construct an unscoped Prisma query.
export const prisma: PrismaClient = globalThis.__prismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = prisma;
}
