import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createTenantContext, type User } from '@sph/database';
import {
  UpgradeRequestService,
  UPGRADE_REQUEST_RECIPIENT,
  MAX_MESSAGE_LENGTH,
  DUPLICATE_SUBMISSION_WINDOW_MS,
  buildUpgradeRequestEmail,
} from './upgrade-request.service';
import { EmailService, EmailDeliveryError, EmailNotConfiguredError } from '../email/email.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    organizationId: 'org-1',
    microsoftTenantId: 'tenant-1',
    entraObjectId: 'entra-1',
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    role: 'Member',
    status: 'Active',
    createdAt: new Date(),
    lastLoginAt: null,
    ...overrides,
  } as User;
}

describe('UpgradeRequestService (Phase 6)', () => {
  const upgradeRequests = { findMany: jest.fn(), create: jest.fn() };
  const organization = { get: jest.fn() };
  const entitlement = { get: jest.fn() };
  const emailService = { send: jest.fn() } as unknown as jest.Mocked<EmailService>;

  const service = new UpgradeRequestService(emailService);

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ upgradeRequests, organization, entitlement } as never);
    upgradeRequests.findMany.mockResolvedValue([]); // no recent duplicate by default
    organization.get.mockResolvedValue({ id: 'org-1', name: 'Onwell Group' });
    entitlement.get.mockResolvedValue({ planType: 'Trial', documentLimit: 2000, currentDocumentCount: 2000 });
    upgradeRequests.create.mockResolvedValue({
      id: 'req-1',
      organizationId: 'org-1',
      requestedByUserId: 'user-1',
      message: null,
      status: 'Pending',
      createdAt: new Date('2026-09-22T12:30:00.000Z'),
    });
    emailService.send.mockResolvedValue(undefined);
  });

  it('an authenticated user can submit a request — creates a row and sends the email', async () => {
    const result = await service.requestUpgrade('org-1', user(), 'We need more capacity.');

    expect(upgradeRequests.create).toHaveBeenCalledWith({ requestedByUserId: 'user-1', message: 'We need more capacity.' });
    expect(emailService.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: 'req-1', status: 'Pending', createdAt: '2026-09-22T12:30:00.000Z' });
  });

  it('scopes every read/write through createTenantContext(organizationId) — never a client-supplied org', async () => {
    await service.requestUpgrade('org-1', user(), undefined);
    expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
  });

  it('sends the email to the fixed recipient hi@Jeslor.com', async () => {
    await service.requestUpgrade('org-1', user(), undefined);
    expect(emailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: UPGRADE_REQUEST_RECIPIENT }));
    expect(UPGRADE_REQUEST_RECIPIENT).toBe('hi@Jeslor.com');
  });

  it('derives organization name/id and usage entirely from the backend, never from the request body', async () => {
    organization.get.mockResolvedValue({ id: 'org-777', name: 'Acme Corporation' });
    entitlement.get.mockResolvedValue({ planType: 'Trial', documentLimit: 2000, currentDocumentCount: 1500 });

    await service.requestUpgrade('org-1', user(), undefined);

    const [emailArg] = emailService.send.mock.calls[0] as [{ to: string; subject: string; text: string }];
    expect(emailArg.subject).toBe('SharePoint Knowledge Health — Upgrade Request — Acme Corporation');
    expect(emailArg.text).toContain('Organization: Acme Corporation');
    expect(emailArg.text).toContain('Organization ID: org-777');
    expect(emailArg.text).toContain('Document usage: 1,500 / 2,000');
  });

  it('rejects a message longer than MAX_MESSAGE_LENGTH', async () => {
    const tooLong = 'x'.repeat(MAX_MESSAGE_LENGTH + 1);
    await expect(service.requestUpgrade('org-1', user(), tooLong)).rejects.toThrow(BadRequestException);
    expect(upgradeRequests.create).not.toHaveBeenCalled();
  });

  it('accepts a message at exactly MAX_MESSAGE_LENGTH', async () => {
    const exact = 'x'.repeat(MAX_MESSAGE_LENGTH);
    await expect(service.requestUpgrade('org-1', user(), exact)).resolves.toBeDefined();
  });

  it('normalizes an empty/whitespace-only message to null rather than persisting blank text', async () => {
    await service.requestUpgrade('org-1', user(), '   ');
    expect(upgradeRequests.create).toHaveBeenCalledWith({ requestedByUserId: 'user-1', message: null });
  });

  it('throws NotFoundException when the organization has no entitlement row', async () => {
    entitlement.get.mockResolvedValue(null);
    await expect(service.requestUpgrade('org-1', user(), undefined)).rejects.toThrow(NotFoundException);
    expect(upgradeRequests.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the organization row is missing', async () => {
    organization.get.mockResolvedValue(null);
    await expect(service.requestUpgrade('org-1', user(), undefined)).rejects.toThrow(NotFoundException);
    expect(upgradeRequests.create).not.toHaveBeenCalled();
  });

  describe('email failure semantics', () => {
    it('does not tell the caller the request succeeded when email delivery fails, but the row still persists', async () => {
      emailService.send.mockRejectedValue(new Error('Resend rejected the request (HTTP 422)'));

      await expect(service.requestUpgrade('org-1', user(), undefined)).rejects.toThrow(ServiceUnavailableException);
      // The row was already created before the email attempt — not lost.
      expect(upgradeRequests.create).toHaveBeenCalledTimes(1);
    });

    it('never leaks the underlying provider error message to the caller', async () => {
      emailService.send.mockRejectedValue(new Error('Resend API key re_live_abc123 rejected: internal_id req_xyz'));

      const error = await service.requestUpgrade('org-1', user(), undefined).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const message = (error as ServiceUnavailableException).message;
      expect(message).not.toContain('re_live_abc123');
      expect(message).not.toContain('req_xyz');
    });

    // Root-cause diagnosis regression: a flat prose log line made "Resend
    // rejected the sender domain" indistinguishable from any other failure
    // without re-reading source. These structured fields are what an
    // operator actually greps for.
    it('logs a structured upgrade_email_failed line with status/error_type/organizationId/requestId when Resend rejects the request', async () => {
      emailService.send.mockRejectedValue(
        new EmailDeliveryError(403, 'The jeslor.com domain is not verified. Please, add and verify your domain on https://resend.com/domains'),
      );
      const logSpy = jest.spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      await service.requestUpgrade('org-1', user(), undefined).catch(() => undefined);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /^upgrade_email_failed provider=resend status=403 error_type=provider_rejected organizationId=org-1 requestId=req-1 detail=.*domain is not verified/,
        ),
      );
    });

    it('logs error_type=not_configured (distinct from a provider rejection) when EMAIL_API_KEY\\/EMAIL_FROM are unset', async () => {
      emailService.send.mockRejectedValue(new EmailNotConfiguredError());
      const logSpy = jest.spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      await service.requestUpgrade('org-1', user(), undefined).catch(() => undefined);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('upgrade_email_failed provider=resend status=n/a error_type=not_configured organizationId=org-1 requestId=req-1'),
      );
    });

    it('never logs the API key or provider auth header, even on failure', async () => {
      emailService.send.mockRejectedValue(new EmailDeliveryError(401, 'Unauthorized'));
      const logSpy = jest.spyOn((service as unknown as { logger: { error: jest.Mock } }).logger, 'error');

      await service.requestUpgrade('org-1', user(), undefined).catch(() => undefined);

      const loggedText = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(loggedText).not.toMatch(/bearer\s+re_/i);
    });
  });

  describe('duplicate-submission protection', () => {
    it('returns the existing request instead of creating a new one when the same user submitted within the window', async () => {
      const existing = {
        id: 'req-existing',
        organizationId: 'org-1',
        requestedByUserId: 'user-1',
        message: 'first attempt',
        status: 'Pending',
        createdAt: new Date('2026-09-22T12:29:50.000Z'),
      };
      upgradeRequests.findMany.mockResolvedValue([existing]);

      const result = await service.requestUpgrade('org-1', user(), 'accidental second click');

      expect(upgradeRequests.create).not.toHaveBeenCalled();
      expect(emailService.send).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'req-existing', status: 'Pending', createdAt: '2026-09-22T12:29:50.000Z' });
    });

    it('queries only this user\'s recent requests within DUPLICATE_SUBMISSION_WINDOW_MS', async () => {
      await service.requestUpgrade('org-1', user({ id: 'user-42' }), undefined);

      expect(upgradeRequests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { requestedByUserId: 'user-42', createdAt: { gt: expect.any(Date) } },
        }),
      );
      const [[call]] = upgradeRequests.findMany.mock.calls;
      const gtDate = (call.where.createdAt as { gt: Date }).gt;
      expect(Date.now() - gtDate.getTime()).toBeLessThanOrEqual(DUPLICATE_SUBMISSION_WINDOW_MS + 1000);
    });
  });
});

describe('buildUpgradeRequestEmail (Phase 6)', () => {
  const organization = { id: 'org-777', name: 'Onwell Group', status: 'Active' as const, createdAt: new Date(), updatedAt: new Date() };
  const requester = {
    id: 'user-1',
    organizationId: 'org-777',
    microsoftTenantId: 'tenant-1',
    entraObjectId: 'entra-1',
    email: 'jane@example.com',
    displayName: 'Jane Doe',
    role: 'Member' as const,
    status: 'Active' as const,
    createdAt: new Date(),
    lastLoginAt: null,
  };
  const usage = {
    planType: 'Trial' as const,
    documentLimit: 2000,
    currentDocumentCount: 2000,
    remainingDocumentCount: 0,
    usagePercentage: 100,
    limitReached: true,
  };

  it('includes every field the task requires: organization, org id, requester, email, plan, usage, message, timestamp', () => {
    const { subject, text } = buildUpgradeRequestEmail({
      organization,
      user: requester,
      usage,
      message: 'We expect approximately 15,000 documents and would like to discuss upgrading.',
      requestedAt: new Date('2026-09-22T12:30:00.000Z'),
    });

    expect(subject).toBe('SharePoint Knowledge Health — Upgrade Request — Onwell Group');
    expect(text).toContain('Organization: Onwell Group');
    expect(text).toContain('Organization ID: org-777');
    expect(text).toContain('Requested by: Jane Doe');
    expect(text).toContain('Email: jane@example.com');
    expect(text).toContain('Current plan: Trial');
    expect(text).toContain('Document usage: 2,000 / 2,000');
    expect(text).toContain('Usage: 100%');
    expect(text).toContain('Message: We expect approximately 15,000 documents and would like to discuss upgrading.');
    expect(text).toContain('Requested: 22 September 2026, 12:30 UTC');
  });

  it('shows a clear placeholder when no message was provided, never a blank line', () => {
    const { text } = buildUpgradeRequestEmail({ organization, user: requester, usage, message: null, requestedAt: new Date() });
    expect(text).toContain('Message: (none provided)');
  });

  it('never includes secrets, tokens, or SharePoint content', () => {
    const { text, subject } = buildUpgradeRequestEmail({ organization, user: requester, usage, message: null, requestedAt: new Date() });
    expect(`${subject}\n${text}`).not.toMatch(/token|secret|graph\.microsoft/i);
  });
});
