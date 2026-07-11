import { Body, Controller, ForbiddenException, Post, UnauthorizedException } from '@nestjs/common';
import { resolveOrProvisionFromConsent } from '@sph/database';
import { entraJwks, verifyEntraToken } from './entra-jwt.guard';
import type { ConsentCallbackRequest } from './consent-callback.dto';

/**
 * ADR-0012 §1/§3: the ONLY place a brand-new Organization can be created.
 * Deliberately not behind TenantContextGuard — there is no existing
 * user/org to resolve yet by definition. Secured by OAuth flow integrity
 * (state parameter, handled by whatever initiates the admin-consent
 * redirect), not by the guard chain used elsewhere.
 */
@Controller('auth')
export class ConsentCallbackController {
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

    return resolution;
  }
}
