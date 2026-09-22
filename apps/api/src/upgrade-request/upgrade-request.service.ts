import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createTenantContext, type Organization, type UpgradeRequest, type User } from '@sph/database';
import type { RequestUpgradeResponse, UsageResponse } from '@sph/types';
import { EmailService } from '../email/email.service';
import { toUsageResponse } from '../usage/usage.service';

// Fixed business destination, not environment configuration — unlike
// EMAIL_API_KEY/EMAIL_FROM (which vary per deployment/provider account),
// this recipient is a product decision, not infrastructure.
export const UPGRADE_REQUEST_RECIPIENT = 'hi@Jeslor.com';

// Defensive bound on a free-text field — nothing this specific, just "not
// unbounded" (matches the task's own explicit requirement).
export const MAX_MESSAGE_LENGTH = 2000;

// Cheap, query-based duplicate-submission guard — mirrors
// ScansService.triggerScan's own "is one already in flight" check
// (apps/api/src/scans/scans.service.ts), not a generic rate limiter. A
// resubmission by the same user within this window is treated as the same
// request: no new row, no second email, the original request is returned
// unchanged.
export const DUPLICATE_SUBMISSION_WINDOW_MS = 60_000;

function toRequestUpgradeResponse(request: UpgradeRequest): RequestUpgradeResponse {
  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}

export interface BuildUpgradeRequestEmailInput {
  organization: Organization;
  user: User;
  usage: UsageResponse;
  message: string | null;
  requestedAt: Date;
}

/**
 * Pure and exported for direct unit testing (matches
 * scans.service.ts's toScanResponse / usage.service.ts's toUsageResponse
 * precedent). Every value here comes from server-derived input — the
 * caller (requestUpgrade) is what enforces that none of it originated from
 * the client, this function just formats. Never includes secrets, tokens,
 * or document/SharePoint content.
 */
export function buildUpgradeRequestEmail(input: BuildUpgradeRequestEmailInput): { subject: string; text: string } {
  const subject = `SharePoint Knowledge Health — Upgrade Request — ${input.organization.name}`;

  const requestedAt = `${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(input.requestedAt)}, ${new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(input.requestedAt)} UTC`;

  const usagePercentage = input.usage.usagePercentage === null ? 'n/a' : `${input.usage.usagePercentage}%`;

  const text = [
    'Upgrade Request',
    '',
    `Organization: ${input.organization.name}`,
    `Organization ID: ${input.organization.id}`,
    `Requested by: ${input.user.displayName}`,
    `Email: ${input.user.email}`,
    `Current plan: ${input.usage.planType}`,
    `Document usage: ${input.usage.currentDocumentCount.toLocaleString()} / ${input.usage.documentLimit.toLocaleString()}`,
    `Usage: ${usagePercentage}`,
    `Message: ${input.message ?? '(none provided)'}`,
    `Requested: ${requestedAt}`,
  ].join('\n');

  return { subject, text };
}

/**
 * Phase 6: the human-assisted "Request an upgrade" workflow — a request
 * record plus one notification email, never billing/enforcement. The
 * worker's entitlement layer (packages/database's entitlement.ts) remains
 * completely unaffected by anything here; this service only ever reads
 * organization/entitlement state, never writes to OrganizationEntitlement.
 */
@Injectable()
export class UpgradeRequestService {
  private readonly logger = new Logger(UpgradeRequestService.name);

  constructor(private readonly emailService: EmailService) {}

  async requestUpgrade(organizationId: string, user: User, message: string | undefined): Promise<RequestUpgradeResponse> {
    if (message !== undefined && message.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(`message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }
    const trimmed = message?.trim();
    const normalizedMessage = trimmed && trimmed.length > 0 ? trimmed : null;

    const context = createTenantContext(organizationId);

    const [recent] = await context.upgradeRequests.findMany({
      where: { requestedByUserId: user.id, createdAt: { gt: new Date(Date.now() - DUPLICATE_SUBMISSION_WINDOW_MS) } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (recent) {
      return toRequestUpgradeResponse(recent);
    }

    // Organization name, plan, and usage counts are ALWAYS re-derived here
    // from the authenticated tenant context — never accepted from the
    // request body. RequestUpgradeRequest (packages/types) only carries
    // `message`.
    const [organization, entitlement] = await Promise.all([context.organization.get(), context.entitlement.get()]);
    if (!organization) throw new NotFoundException('Organization not found');
    if (!entitlement) throw new NotFoundException('No entitlement found for this organization');

    // Written before the email attempt — a request must never be silently
    // lost just because the email provider has a transient failure (see
    // EmailService's own module comment for why this isn't a queued job).
    const created = await context.upgradeRequests.create({ requestedByUserId: user.id, message: normalizedMessage });

    const { subject, text } = buildUpgradeRequestEmail({
      organization,
      user,
      usage: toUsageResponse(entitlement),
      message: normalizedMessage,
      requestedAt: created.createdAt,
    });

    try {
      await this.emailService.send({ to: UPGRADE_REQUEST_RECIPIENT, subject, text });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to send upgrade-request email for UpgradeRequest ${created.id} (organization ${organizationId}): ${detail}`,
      );
      // The UpgradeRequest row above already committed — not silently
      // lost — but the user must never be told "sent" when delivery
      // didn't actually succeed.
      throw new ServiceUnavailableException("We couldn't send your request. Please try again.");
    }

    return toRequestUpgradeResponse(created);
  }
}
