import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Request } from 'express';
import type { EntraClaims } from './types';

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Work/school accounts only (not `common`, which also accepts personal
// Microsoft accounts — not this product's account model). Module-scoped
// singleton: createRemoteJWKSet caches internally and must be reused across
// requests, never recreated per call.
export const entraJwks: JWTVerifyGetKey = createRemoteJWKSet(
  new URL('https://login.microsoftonline.com/organizations/discovery/v2.0/keys'),
);

/**
 * Verifies an Entra ID JWT's signature and standard claims (aud, exp, nbf,
 * alg pinned to RS256), then manually reconciles the tenant-specific issuer
 * — a multi-tenant app registration can't pin a single fixed issuer string,
 * so jose's `issuer` option (which only accepts a static string) can't be
 * used for this; iss is checked against the token's own tid claim instead,
 * matching Microsoft's documented validation algorithm for multi-tenant
 * resource servers.
 *
 * Exported standalone so it can be unit-tested against a local test JWKS,
 * without a live Microsoft endpoint.
 */
export async function verifyEntraToken(
  token: string,
  options: { jwks: JWTVerifyGetKey; clientId: string },
): Promise<EntraClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, options.jwks, {
      audience: options.clientId,
      algorithms: ['RS256'],
    }));
  } catch {
    throw new UnauthorizedException('Invalid token');
  }

  const tid = typeof payload.tid === 'string' ? payload.tid : undefined;
  const oid = typeof payload.oid === 'string' ? payload.oid : undefined;
  if (!tid || !TENANT_ID_PATTERN.test(tid) || !oid) {
    throw new UnauthorizedException('Missing or malformed tid/oid claim');
  }

  const expectedIssuer = `https://login.microsoftonline.com/${tid}/v2.0`;
  if (payload.iss !== expectedIssuer) {
    throw new UnauthorizedException('Issuer/tenant mismatch');
  }

  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const name = typeof payload.name === 'string' ? payload.name : undefined;

  return { tid, oid, email, name };
}

@Injectable()
export class EntraJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length);

    const clientId = process.env.ENTRA_CLIENT_ID;
    if (!clientId) {
      throw new UnauthorizedException('Server misconfigured');
    }

    request.entraClaims = await verifyEntraToken(token, { jwks: entraJwks, clientId });
    return true;
  }
}
