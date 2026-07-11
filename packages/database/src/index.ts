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
export const prisma: PrismaClient = globalThis.__prismaClient ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prismaClient = prisma;
}

export type { PrismaClient } from '@prisma/client';
