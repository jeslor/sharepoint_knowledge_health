import { EmailService, EmailNotConfiguredError } from './email.service';

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

    it('throws a clean error (no provider response body leaked) when the provider rejects the request', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 422, text: () => Promise.resolve('{"message":"Invalid from address","internal_id":"req_abc123"}') }) as unknown as typeof fetch;

      const error = await service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('req_abc123');
      expect((error as Error).message).not.toContain('re_test_key');
    });

    it('propagates a network-level failure (fetch itself rejects)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed: ECONNREFUSED')) as unknown as typeof fetch;

      await expect(service.send({ to: 'hi@jeslor.com', subject: 'Subject', text: 'Body' })).rejects.toThrow();
    });
  });
});
