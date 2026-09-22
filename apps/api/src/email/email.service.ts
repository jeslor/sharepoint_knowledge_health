import { Injectable, Logger } from '@nestjs/common';

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
}

// Thrown when EMAIL_API_KEY/EMAIL_FROM aren't set — distinct from a
// provider-side failure so a caller/log line can tell "nobody configured
// this yet" apart from "Resend rejected the request." Both currently
// result in the same user-facing behavior (upgrade-request.service.ts
// treats email failure uniformly), but keeping them distinguishable costs
// nothing and helps whoever reads the server logs.
export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured (EMAIL_API_KEY/EMAIL_FROM are not set)');
    this.name = 'EmailNotConfiguredError';
  }
}

/**
 * Phase 6: this application's first email dependency — see the "email
 * infrastructure" search this phase's report documents (no SMTP/
 * SendGrid/Resend/Graph Mail.Send existed anywhere before this). Graph's
 * Mail.Send was deliberately NOT used: it would require a new Graph
 * permission scope, a dedicated mailbox + Exchange Application Access
 * Policy, and its own Azure app registration (exactly what ADR-0021 §D.3
 * already flagged as "the correct point to introduce... own ADR" for a
 * real notification-channel build-out) — far more than "send one
 * transactional email to our own inbox" warrants. Resend's plain REST API
 * needs zero new npm dependency (native fetch, Node >=20) and a single API
 * key, matching this project's "avoid unnecessary dependencies" principle
 * and the "smallest production-appropriate approach" this task asked for.
 *
 * Synchronous, not BullMQ-queued: the caller (UpgradeRequestService) needs
 * to know within the same HTTP request whether delivery actually
 * succeeded, so it can honestly tell the user "sent" vs "please retry" —
 * a fire-and-forget queued job can't give that answer at response time.
 *
 * Text-only (no HTML templating dependency) — sufficient for a single
 * internal notification email; nothing here renders user-facing HTML.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(input: SendEmailInput): Promise<void> {
    const apiKey = process.env.EMAIL_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new EmailNotConfiguredError();
    }

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });

    if (!response.ok) {
      // Logged server-side only — the response body may include
      // provider-specific detail that has no business reaching an API
      // client (this codebase's existing convention: ErrorState-style
      // caller-facing messages never include internal implementation
      // detail). Never logs apiKey/from.
      const body = await response.text().catch(() => '');
      this.logger.error(`Resend rejected the email request (HTTP ${response.status}): ${body}`);
      throw new Error(`Email provider returned HTTP ${response.status}`);
    }
  }
}
