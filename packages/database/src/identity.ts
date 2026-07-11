import type { User } from '@prisma/client';
import { prisma } from './client';

/**
 * The one sanctioned unscoped lookup in this package. Used only during auth
 * token resolution, before an organizationId — and therefore a TenantContext
 * — exists. Every other database access must go through createTenantContext().
 */
export async function findUserByEntraObjectId(entraObjectId: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { entraObjectId } });
}
