import { Body, Controller, ForbiddenException, Logger, Post, UnauthorizedException } from '@nestjs/common';
import {
  applyConsentAssertion,
  applyVerifiedReadPermission,
  createTenantContext,
  derivePermissionReconsentState,
  REQUIRED_PERMISSION_VERSION,
  resolveOrProvisionFromConsent,
  type ConsentResolution,
} from '@sph/database';
import type { ConsentResolution as ConsentResolutionResponse } from '@sph/types';
import { entraJwks, verifyEntraToken } from './entra-jwt.guard';
import type { ConsentCallbackRequest } from './consent-callback.dto';
import { DiscoveryProducerService } from '../discovery/discovery-producer.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { GraphConsentVerifierService } from './graph-consent-verifier.service';

type NonRejectedResolution = Exclude<ConsentResolution, { kind: 'rejected' }>;

/**
 * ADR-0012 §1/§3: the ONLY place a brand-new Organization can be created.
 * Deliberately not behind TenantContextGuard — there is no existing
 * user/org to resolve yet by definition. Secured by OAuth flow integrity
 * (state parameter, handled by whatever initiates the admin-consent
 * redirect), not by the guard chain used elsewhere.
 */
@Controller('auth')
export class ConsentCallbackController {
  private readonly logger = new Logger(ConsentCallbackController.name);

  constructor(
    private readonly discoveryProducer: DiscoveryProducerService,
    private readonly auditLog: AuditLogService,
    private readonly consentVerifier: GraphConsentVerifierService,
  ) {}

  @Post('consent-callback')
  async handleConsentCallback(@Body() body: ConsentCallbackRequest): Promise<ConsentResolutionResponse> {
    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      throw new UnauthorizedException('Server misconfigured');
    }

    const claims = await verifyEntraToken(body.idToken, { jwks: entraJwks, clientId });

    const resolution = await resolveOrProvisionFromConsent(
      claims.tid,
      claims.oid,
      body.tenantName,
      { email: claims.email ?? '', displayName: claims.name ?? '' },
      this.consentVerifier,
    );

    if (resolution.kind === 'rejected') {
      throw new ForbiddenException('This Microsoft tenant has not completed admin consent');
    }

    // ADR-0014 amendment / ADR-0017: 'bootstrapped' is the one resolution
    // kind where a MicrosoftTenant just transitioned to Consented — the
    // exact moment discovery should fire (ADR-0014 §1's original intent).
    // Awaited (enqueueing itself is a fast Postgres write + Redis call, not
    // the discovery job's actual execution) rather than fire-and-forget, so
    // the enqueue reliably happens before this request completes instead of
    // racing a process exit — but still best-effort: a failure here is
    // logged, never rethrown, so it cannot turn a successful bootstrap into
    // an error response. DiscoveryProducerService's own compensating write
    // already leaves the tenant in a correctly-observable Failed state on
    // enqueue failure, and the manual "Discover sites" button remains a
    // self-service retry path regardless.
    if (resolution.kind === 'bootstrapped') {
      // Recorded here, not inside the discovery try/catch below: the
      // bootstrap transaction (Organization/MicrosoftTenant/first User)
      // has already fully committed by the time resolution.kind ===
      // 'bootstrapped' is observed — the tenant genuinely is connected
      // regardless of whether the best-effort discovery enqueue that
      // follows succeeds. Only 'bootstrapped' logs this action: 'existing'
      // and 'provisioned-pending' mean this tid was already connected, not
      // a new connection event.
      await this.auditLog.record(resolution.organizationId, {
        actorUserId: resolution.userId,
        action: 'microsoft_tenant.connected',
        targetType: 'MicrosoftTenant',
        targetId: resolution.microsoftTenantId,
      });

      try {
        await this.discoveryProducer.enqueueDiscovery(resolution.organizationId, resolution.microsoftTenantId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to enqueue discovery for newly-bootstrapped org ${resolution.organizationId}: ${message}`);
      }
    }

    // ADR-0023: reaching this endpoint at all means a real admin-consent
    // redirect just completed, for every non-rejected kind — not just
    // 'bootstrapped'. Both steps are best-effort and must never turn an
    // otherwise-successful sign-in into a failure.
    await this.recordConsentAssertion(resolution);
    await this.refreshVerifiedReadPermission(resolution, claims.tid);

    const context = createTenantContext(resolution.organizationId);
    const tenant = await context.microsoftTenants.findFirstById(resolution.microsoftTenantId);

    return {
      ...resolution,
      needsReconsent: tenant ? derivePermissionReconsentState(tenant).needsReconsent : false,
    };
  }

  /**
   * ADR-0023 §3.3/§3.7/§3.9: records ONLY that a real admin-consent redirect
   * completed for the current required version — an assertion, never proof
   * of the effective (in particular, write) grant. Advances unconditionally
   * for every non-rejected resolution; audits only when it actually changes
   * something, matching this app's existing no-noise audit discipline
   * (ADR-0021) — a tenant already at the current version produces no
   * duplicate entry.
   */
  private async recordConsentAssertion(resolution: NonRejectedResolution): Promise<void> {
    const { advanced } = await applyConsentAssertion(resolution.microsoftTenantId, REQUIRED_PERMISSION_VERSION, new Date());
    if (!advanced) return;

    await this.auditLog.record(resolution.organizationId, {
      actorUserId: resolution.userId,
      action: 'microsoft_tenant.permission_consent_asserted',
      targetType: 'MicrosoftTenant',
      targetId: resolution.microsoftTenantId,
      metadata: { permissionVersion: REQUIRED_PERMISSION_VERSION },
    });
  }

  /**
   * ADR-0023 §3.5/§3.6/§3.7: best-effort, never allowed to fail an
   * otherwise-successful sign-in. For 'bootstrapped', the read-scope check
   * already just ran (and passed) inside resolveOrProvisionFromConsent's own
   * mandatory pre-bootstrap gate — recording it here avoids a redundant
   * Graph call. For 'existing'/'provisioned-pending', a fresh real check
   * runs; a ConsentVerificationError (denied) or any infrastructure error
   * leaves verifiedReadPermissionVersion untouched — never downgraded, never
   * treated as "not granted" just because Graph was unreachable.
   */
  private async refreshVerifiedReadPermission(resolution: NonRejectedResolution, entraTenantId: string): Promise<void> {
    if (resolution.kind === 'bootstrapped') {
      await applyVerifiedReadPermission(resolution.microsoftTenantId, REQUIRED_PERMISSION_VERSION).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to record verified-read-permission for bootstrapped tenant ${resolution.microsoftTenantId}: ${message}`);
      });
      return;
    }

    try {
      await this.consentVerifier.verifyTenantConsent(entraTenantId);
      await applyVerifiedReadPermission(resolution.microsoftTenantId, REQUIRED_PERMISSION_VERSION);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Read-permission re-verification did not succeed for tenant ${resolution.microsoftTenantId} (leaving verifiedReadPermissionVersion unchanged): ${message}`,
      );
    }
  }
}
