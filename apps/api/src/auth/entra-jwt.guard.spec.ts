import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Request } from 'express';
import { EntraJwtGuard, verifyEntraToken } from './entra-jwt.guard';

const CLIENT_ID = 'test-client-id';
const TID = '11111111-1111-1111-1111-111111111111';
const OID = '22222222-2222-2222-2222-222222222222';

describe('verifyEntraToken', () => {
  let jwks: JWTVerifyGetKey;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

  beforeAll(async () => {
    const { publicKey, privateKey: privKey } = await generateKeyPair('RS256');
    privateKey = privKey;
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-key';
    jwk.alg = 'RS256';
    jwks = createLocalJWKSet({ keys: [jwk] });
  });

  async function signToken(
    claimOverrides: Record<string, unknown> = {},
    options: { expired?: boolean; issuerTid?: string } = {},
  ): Promise<string> {
    const claims = { tid: TID, oid: OID, ...claimOverrides };
    let builder = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setAudience(CLIENT_ID)
      // Defaults to matching TID — tests that want a tid/iss mismatch pass
      // `issuerTid` explicitly rather than relying on claimOverrides.tid,
      // since the issuer string and the tid claim are independent fields.
      .setIssuer(`https://login.microsoftonline.com/${options.issuerTid ?? TID}/v2.0`);

    builder = options.expired
      ? builder.setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      : builder.setExpirationTime('5m');

    return builder.sign(privateKey);
  }

  it('accepts a validly signed token and extracts tid/oid', async () => {
    const token = await signToken();
    const claims = await verifyEntraToken(token, { jwks, clientId: CLIENT_ID });
    expect(claims.tid).toBe(TID);
    expect(claims.oid).toBe(OID);
  });

  it('extracts optional email/name claims for display purposes only', async () => {
    const token = await signToken({ email: 'person@example.com', name: 'Person' });
    const claims = await verifyEntraToken(token, { jwks, clientId: CLIENT_ID });
    expect(claims.email).toBe('person@example.com');
    expect(claims.name).toBe('Person');
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await signToken();
    await expect(verifyEntraToken(token, { jwks, clientId: 'wrong-client-id' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired token', async () => {
    const token = await signToken({}, { expired: true });
    await expect(verifyEntraToken(token, { jwks, clientId: CLIENT_ID })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose iss tenant does not match its own tid claim', async () => {
    const token = await signToken({}, { issuerTid: '33333333-3333-3333-3333-333333333333' });
    await expect(verifyEntraToken(token, { jwks, clientId: CLIENT_ID })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token missing the oid claim', async () => {
    const token = await signToken({ oid: undefined });
    await expect(verifyEntraToken(token, { jwks, clientId: CLIENT_ID })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token with a malformed tid', async () => {
    const token = await signToken({ tid: 'not-a-guid' }, { issuerTid: 'not-a-guid' });
    await expect(verifyEntraToken(token, { jwks, clientId: CLIENT_ID })).rejects.toThrow(UnauthorizedException);
  });
});

describe('EntraJwtGuard', () => {
  function mockContext(headers: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: (): Partial<Request> => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  }

  it('rejects a request with no Authorization header', async () => {
    const guard = new EntraJwtGuard();
    await expect(guard.canActivate(mockContext({}))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a request with a non-Bearer Authorization header', async () => {
    const guard = new EntraJwtGuard();
    await expect(guard.canActivate(mockContext({ authorization: 'Basic abc123' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when ENTRA_CLIENT_ID is not configured', async () => {
    const original = process.env.ENTRA_CLIENT_ID;
    delete process.env.ENTRA_CLIENT_ID;

    const guard = new EntraJwtGuard();
    await expect(guard.canActivate(mockContext({ authorization: 'Bearer sometoken' }))).rejects.toThrow(
      UnauthorizedException,
    );

    if (original !== undefined) process.env.ENTRA_CLIENT_ID = original;
  });
});
