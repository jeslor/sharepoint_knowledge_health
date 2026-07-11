import type { User } from '@prisma/client';
import { prisma } from './client';

/**
 * The one sanctioned unscoped lookup in this package. Used only during auth
 * token resolution, before an organizationId — and therefore a
 * TenantContext — exists.
 *
 * Requires BOTH the Entra ID token's tid (tenant ID) and oid (object ID)
 * claims (ADR-0010). The oid claim is only guaranteed unique within the
 * Azure AD tenant that issued it — Microsoft's own multi-tenant app
 * guidance requires the oid+tid combination as the unique identifying key,
 * never oid alone. A User is looked up by entraObjectId scoped to the
 * MicrosoftTenant whose entraTenantId matches the token's tid, matching the
 * compound @@unique([microsoftTenantId, entraObjectId]) constraint.
 *
 * Every other database access must go through createTenantContext().
 */
export async function findUserByEntraIdentity(
  entraTenantId: string,
  entraObjectId: string,
): Promise<User | null> {
  return prisma.user.findFirst({
    where: {
      entraObjectId,
      microsoftTenant: { entraTenantId },
    },
  });
}
