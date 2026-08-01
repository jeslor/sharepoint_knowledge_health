import { Body, Controller, ForbiddenException, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { resolveOrProvisionFromConsent } from '@sph/database';
import { entraJwks, verifyEntraToken } from './entra-jwt.guard';
import type { ConsentCallbackRequest } from './consent-callback.dto';
import { DiscoveryProducerService } from '../discovery/discovery-producer.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { GraphConsentVerifierService } from './graph-consent-verifier.service';

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
  async handleConsentCallback(@Body() body: ConsentCallbackRequest) {
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

    return resolution;
  }
}
