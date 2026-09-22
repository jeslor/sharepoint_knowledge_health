import { EmailService, EmailNotConfiguredError, EmailDeliveryError } from './email.service';

describe('EmailService (Phase 6)', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.EMAIL_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;
  const service = new EmailService();

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.EMAIL_API_KEY = originalApiKey;
    process.env.EMAIL_FROM = originalFrom;
  });

  describe('when not configured', () => {
    it('throws EmailNotConfiguredError when EMAIL_API_KEY is missing, without calling fetch', async () => {
      delete process.env.EMAIL_API_KEY;
      process.env.EMAIL_FROM = 'Knowledge Health <upgrades@example.com>';
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' })).rejects.toThrow(
        EmailNotConfiguredError,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('throws EmailNotConfiguredError when EMAIL_FROM is missing', async () => {
      process.env.EMAIL_API_KEY = 're_test_key';
      delete process.env.EMAIL_FROM;
      global.fetch = jest.fn() as unknown as typeof fetch;

      await expect(service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' })).rejects.toThrow(
        EmailNotConfiguredError,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('when configured', () => {
    beforeEach(() => {
      process.env.EMAIL_API_KEY = 're_test_key';
      process.env.EMAIL_FROM = 'Knowledge Health <upgrades@example.com>';
    });

    it('POSTs to the Resend API with the API key as a bearer token, never in the body/URL', async () => {
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = mockFetch as unknown as typeof fetch;

      await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json' }),
        }),
      );
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body).toEqual({
        from: 'Knowledge Health <upgrades@example.com>',
        to: ['hi@jeslor.com'],
        subject: 'Subject',
        text: 'Body',
      });
    });

    it('resolves without throwing when the provider accepts the request', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;

      await expect(service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' })).resolves.toBeUndefined();
    });

    it('throws EmailDeliveryError (no API key leaked) when the provider rejects the request', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('{"message":"Invalid from address","internal_id":"req_abc123"}') }) as unknown as typeof fetch;

      const error = await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect((error as EmailDeliveryError).status).toBe(422);
      expect((error as EmailDeliveryError).providerMessage).toContain('Invalid from address');
      expect((error as EmailDeliveryError).message).not.toContain('req_abc123');
      expect((error as EmailDeliveryError).providerMessage).not.toContain('re_test_key');
    });

    // Root-cause regression: exactly the real-world failure this shape was
    // built to surface — Resend rejects an unverified sender domain with a
    // 403 and a small JSON body naming the offending domain.
    it('surfaces a 403 unverified-sender-domain rejection with its status and message intact', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () =>
          Promise.resolve(
            '{"statusCode":403,"message":"The jeslor.com domain is not verified. Please, add and verify your domain on https://resend.com/domains","name":"validation_error"}',
          ),
      }) as unknown as typeof fetch;

      const error = await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EmailDeliveryError);
      expect((error as EmailDeliveryError).status).toBe(403);
      expect((error as EmailDeliveryError).providerMessage).toContain('domain is not verified');
    });

    it('caps an excessively long provider response body before it ever reaches a log line', async () => {
      const hugeBody = 'x'.repeat(10_000);
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve(hugeBody) }) as unknown as typeof fetch;

      const error = await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' }).catch((e: unknown) => e);

      expect((error as EmailDeliveryError).providerMessage.length).toBeLessThanOrEqual(500);
    });

    it('redacts anything bearer-token-shaped in the provider response body, defensively', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('{"message":"Unauthorized, saw Bearer re_test_key in request"}'),
      }) as unknown as typeof fetch;

      const error = await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' }).catch((e: unknown) => e);

      expect((error as EmailDeliveryError).providerMessage).not.toContain('re_test_key');
      expect((error as EmailDeliveryError).providerMessage).toContain('[redacted]');
    });

    it('propagates a network-level failure (fetch itself rejects)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED')) as unknown as typeof fetch;

      await expect(service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' })).rejects.toThrow();
    });
  });
});
