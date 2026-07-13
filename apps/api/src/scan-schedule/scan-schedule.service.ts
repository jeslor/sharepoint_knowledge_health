import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createTenantContext, type ScanSchedule } from '@sph/database';
import type {
  CreateScanScheduleRequest,
  ScanScheduleFrequencyValue,
  ScanScheduleResponse,
  UpdateScanScheduleRequest,
} from '@sph/types';

function computeInitialNextRunAt(frequency: ScanScheduleFrequencyValue, now: Date): Date {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + (frequency === 'Weekly' ? 7 : 1));
  return next;
}

function toScanScheduleResponse(schedule: ScanSchedule): ScanScheduleResponse {
  return {
    id: schedule.id,
    frequency: schedule.frequency,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt.toISOString(),
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

/**
 * CRUD for an organization's recurring scan configuration (ADR-0015 §1,
 * Phase 7B). This service never touches ScanJob or the queue directly —
 * it only maintains the ScanSchedule row apps/worker's scheduler tick
 * later reads via the unscoped findDueScanSchedules. One schedule per
 * organization (organizationId is @unique), so every lookup here is
 * `findMany({ take: 1 })` through the existing generic repository method
 * rather than a bespoke "find by org" method.
 */
@Injectable()
export class ScanScheduleService {
  async getSchedule(organizationId: string): Promise<ScanScheduleResponse | null> {
    const context = createTenantContext(organizationId);
    const [schedule] = await context.scanSchedules.findMany({ take: 1 });
    return schedule ? toScanScheduleResponse(schedule) : null;
  }

  async createSchedule(organizationId: string, request: CreateScanScheduleRequest): Promise<ScanScheduleResponse> {
    const context = createTenantContext(organizationId);
    const [existing] = await context.scanSchedules.findMany({ take: 1 });
    if (existing) {
      throw new ConflictException('This organization already has a scan schedule — use PATCH to update it');
    }

    const now = new Date();
    const schedule = await context.scanSchedules.create({
      frequency: request.frequency,
      enabled: request.enabled ?? true,
      nextRunAt: computeInitialNextRunAt(request.frequency, now),
    });
    return toScanScheduleResponse(schedule);
  }

  async updateSchedule(organizationId: string, request: UpdateScanScheduleRequest): Promise<ScanScheduleResponse> {
    const context = createTenantContext(organizationId);
    const [existing] = await context.scanSchedules.findMany({ take: 1 });
    if (!existing) {
      throw new NotFoundException('No scan schedule configured for this organization');
    }

    // Changing frequency restarts the cadence from now — least surprising
    // (switching Weekly -> Daily shouldn't carry forward a stale
    // weekly-computed nextRunAt). A bare enabled toggle leaves nextRunAt
    // untouched; re-enabling a paused schedule resumes at its next
    // natural time (the scheduler's own max(...) guard already prevents a
    // catch-up burst if that time has since passed).
    const frequencyChanged = request.frequency !== undefined && request.frequency !== existing.frequency;

    const updated = await context.scanSchedules.updateById(existing.id, {
      ...(request.frequency !== undefined ? { frequency: request.frequency } : {}),
      ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
      ...(frequencyChanged && request.frequency !== undefined
        ? { nextRunAt: computeInitialNextRunAt(request.frequency, new Date()) }
        : {}),
    });
    if (!updated) throw new NotFoundException('No scan schedule configured for this organization');
    return toScanScheduleResponse(updated);
  }

  async deleteSchedule(organizationId: string): Promise<void> {
    const context = createTenantContext(organizationId);
    const [existing] = await context.scanSchedules.findMany({ take: 1 });
    if (!existing) {
      throw new NotFoundException('No scan schedule configured for this organization');
    }
    await context.scanSchedules.deleteById(existing.id);
  }
}
