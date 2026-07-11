import type { MicrosoftTenant, User } from '@prisma/client';
import { prisma } from './client';
import { findUserByEntraIdentity } from './identity';

export interface EntraProfile {
  email: string;
  displayName: string;
}

export interface BootstrapResult {
  organizationId: string;
  microsoftTenantId: string;
  userId: string;
}

export type ConsentResolution =
  | ({ kind: 'existing' } & BootstrapResult)
  | ({ kind: 'bootstrapped' } & BootstrapResult)
  | ({ kind: 'provisioned-pending' } & BootstrapResult)
  | { kind: 'rejected'; reason: 'tenant-not-consented' };

/**
 * ADR-0012 §1: the pre-tenant-context lookup used to decide whether an
 * incoming tid belongs to a brand-new organization or an already-connected
 * one. Sanctioned unscoped operation, alongside identity.ts's
 * findUserByEntraIdentity. entraTenantId is not globally unique (ADR-0007),
 * so this can return more than one row in the rare same-Azure-tenant-under-
 * multiple-Organizations edge case flagged (and deliberately deferred) in
 * ADR-0010/ADR-0012 — ordered oldest-first so any caller that needs a single
 * deterministic candidate gets a stable, non-random choice.
 */
export async function findMicrosoftTenantByEntraTenantId(entraTenantId: string): Promise<MicrosoftTenant[]> {
  return prisma.microsoftTenant.findMany({
    where: { entraTenantId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * ADR-0012 §3: brand-new organization bootstrap, triggered only from the
 * dedicated admin-consent callback flow (never implicitly from a regular
 * protected endpoint). Single transaction — Organization, MicrosoftTenant,
 * and the first User (provisioned as Admin/Active, inheriting trust from
 * Microsoft's own admin-consent privilege check, not a self-declared claim)
 * all succeed together or not at all (ADR-0012 Acceptance Criteria #5).
 *
 * MicrosoftTenant.consentGrantedByUserId is nullable specifically so it can
 * be created before the User it will point back to exists, then backfilled.
 */
export async function provisionOrganizationFromConsent(
  entraTenantId: string,
  entraObjectId: string,
  tenantName: string,
  profile: EntraProfile,
): Promise<BootstrapResult> {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: tenantName },
    });

    const microsoftTenant = await tx.microsoftTenant.create({
      data: {
        organizationId: organization.id,
        entraTenantId,
        tenantName,
        status: 'Consented',
        consentGrantedAt: new Date(),
      },
    });

    const user = await tx.user.create({
      data: {
        organizationId: organization.id,
        microsoftTenantId: microsoftTenant.id,
        entraObjectId,
        email: profile.email,
        displayName: profile.displayName,
        role: 'Admin',
        status: 'Active',
        lastLoginAt: new Date(),
      },
    });

    await tx.microsoftTenant.update({
      where: { id: microsoftTenant.id },
      data: { consentGrantedByUserId: user.id },
    });

    return {
      organizationId: organization.id,
      microsoftTenantId: microsoftTenant.id,
      userId: user.id,
    };
  });
}

/**
 * ADR-0012 §4: a new person signing in for the first time against an
 * already-connected, already-Consented MicrosoftTenant. Provisioned as
 * Member/PendingApproval — identity is fully resolved (they really are who
 * their (tid, oid) says they are), but authorization is withheld until an
 * existing Admin explicitly approves them (ADR-0011's identity/authorization
 * distinction).
 */
export async function provisionUserFromExistingTenant(
  microsoftTenant: Pick<MicrosoftTenant, 'id' | 'organizationId'>,
  entraObjectId: string,
  profile: EntraProfile,
): Promise<User> {
  return prisma.user.create({
    data: {
      organizationId: microsoftTenant.organizationId,
      microsoftTenantId: microsoftTenant.id,
      entraObjectId,
      email: profile.email,
      displayName: profile.displayName,
      role: 'Member',
      status: 'PendingApproval',
      lastLoginAt: new Date(),
    },
  });
}

/**
 * ADR-0012 §1: the full decision tree, as a single unit — used only by the
 * dedicated admin-consent callback flow (never by the general request guard
 * chain, which must reject an unrecognized tid rather than silently
 * bootstrap a new Organization from a random protected route). Calling this
 * twice for the same entraTenantId never creates a second Organization
 * (ADR-0012 Acceptance Criteria #2): the second call finds the
 * already-connected MicrosoftTenant and routes into the existing
 * organization instead.
 */
export async function resolveOrProvisionFromConsent(
  entraTenantId: string,
  entraObjectId: string,
  tenantName: string,
  profile: EntraProfile,
): Promise<ConsentResolution> {
  const existingUser = await findUserByEntraIdentity(entraTenantId, entraObjectId);
  if (existingUser) {
    return {
      kind: 'existing',
      organizationId: existingUser.organizationId,
      microsoftTenantId: existingUser.microsoftTenantId,
      userId: existingUser.id,
    };
  }

  const candidates = await findMicrosoftTenantByEntraTenantId(entraTenantId);

  if (candidates.length === 0) {
    const result = await provisionOrganizationFromConsent(entraTenantId, entraObjectId, tenantName, profile);
    return { kind: 'bootstrapped', ...result };
  }

  const consented = candidates.find((tenant) => tenant.status === 'Consented');
  if (!consented) {
    return { kind: 'rejected', reason: 'tenant-not-consented' };
  }

  const user = await provisionUserFromExistingTenant(consented, entraObjectId, profile);
  return {
    kind: 'provisioned-pending',
    organizationId: consented.organizationId,
    microsoftTenantId: consented.id,
    userId: user.id,
  };
}
