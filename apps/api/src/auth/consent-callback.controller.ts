import { Body, Controller, ForbiddenException, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { resolveOrProvisionFromConsent } from '@sph/database';
import { entraJwks, verifyEntraToken } from './entra-jwt.guard';
import type { ConsentCallbackRequest } from './consent-callback.dto';
import { DiscoveryProducerService } from '../discovery/discovery-producer.service';

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

  constructor(private readonly discoveryProducer: DiscoveryProducerService) {}

  @Post('consent-callback')
  async handleConsentCallback(@Body() body: ConsentCallbackRequest) {
    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      throw new UnauthorizedException('Server misconfigured');
    }

    const claims = await verifyEntraToken(body.idToken, { jwks: entraJwks, clientId });

    const resolution = await resolveOrProvisionFromConsent(claims.tid, claims.oid, body.tenantName, {
      email: claims.email ?? '',
      displayName: claims.name ?? '',
    });

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
