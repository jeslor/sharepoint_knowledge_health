import { NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { UsageService, toUsageResponse } from './usage.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

function entitlement(overrides: Partial<{ planType: string; documentLimit: number; currentDocumentCount: number }> = {}) {
  return {
    id: 'entitlement-1',
    organizationId: 'org-1',
    planType: 'Trial',
    documentLimit: 2000,
    currentDocumentCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

describe('UsageService (Phase 4)', () => {
  const entitlementRepo = { get: jest.fn() };

  const service = new UsageService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ entitlement: entitlementRepo } as never);
  });

  it('scopes the lookup to the organization via createTenantContext — never a client-supplied organizationId source', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement());

    await service.getUsage('org-1');

    expect(mockedCreateContext).toHaveBeenCalledWith('org-1');
  });

  it('a Trial organization below its limit reports the correct counts, percentage, and limitReached: false', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ documentLimit: 2000, currentDocumentCount: 1000 }));

    const result = await service.getUsage('org-1');

    expect(result).toEqual({
      planType: 'Trial',
      documentLimit: 2000,
      currentDocumentCount: 1000,
      remainingDocumentCount: 1000,
      usagePercentage: 50,
      limitReached: false,
    });
  });

  it('a Trial organization exactly at its limit reports remainingDocumentCount: 0, usagePercentage: 100, limitReached: true', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ documentLimit: 2000, currentDocumentCount: 2000 }));

    const result = await service.getUsage('org-1');

    expect(result.remainingDocumentCount).toBe(0);
    expect(result.usagePercentage).toBe(100);
    expect(result.limitReached).toBe(true);
  });

  it('a Trial organization with one remaining slot reports remainingDocumentCount: 1, limitReached: false, and a percentage below 100 (never prematurely 100)', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ documentLimit: 2000, currentDocumentCount: 1999 }));

    const result = await service.getUsage('org-1');

    expect(result.remainingDocumentCount).toBe(1);
    expect(result.limitReached).toBe(false);
    // 1999/2000 = 99.95 — must not round up to 100, which would falsely
    // claim the limit is reached when one slot genuinely remains.
    expect(result.usagePercentage).toBe(99.95);
  });

  it('a brand-new organization (0 documents) reports 0% usage, not null or NaN', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ documentLimit: 2000, currentDocumentCount: 0 }));

    const result = await service.getUsage('org-1');

    expect(result.usagePercentage).toBe(0);
    expect(result.remainingDocumentCount).toBe(2000);
    expect(result.limitReached).toBe(false);
  });

  it('rounds usagePercentage to two decimal places, avoiding floating-point artifacts', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ documentLimit: 3, currentDocumentCount: 1 }));

    const result = await service.getUsage('org-1');

    // 1/3 * 100 = 33.333333... — must be a clean two-decimal number, not a
    // long floating-point tail.
    expect(result.usagePercentage).toBe(33.33);
  });

  it('exposes planType so the frontend never has to infer Trial/Standard from document counts', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement({ planType: 'Standard', documentLimit: 2000, currentDocumentCount: 500 }));

    const result = await service.getUsage('org-1');

    expect(result.planType).toBe('Standard');
  });

  it('never exposes the entitlement row id, organizationId, or timestamps', async () => {
    entitlementRepo.get.mockResolvedValue(entitlement());

    const result = await service.getUsage('org-1');

    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('organizationId');
    expect(result).not.toHaveProperty('createdAt');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('throws NotFoundException when the organization has no entitlement row, rather than defaulting to unlimited or zero usage', async () => {
    entitlementRepo.get.mockResolvedValue(null);

    await expect(service.getUsage('org-1')).rejects.toThrow(NotFoundException);
  });

  // Organization isolation: this service never queries anything except
  // through the tenant-scoped context.entitlement.get() call, which is
  // itself bound to whatever organizationId createTenantContext was given
  // — there is no path here that could read another organization's row.
  it('organization isolation: a second organization\'s call is scoped independently and never influenced by the first', async () => {
    entitlementRepo.get.mockResolvedValueOnce(entitlement({ currentDocumentCount: 100 }));
    await service.getUsage('org-1');
    expect(mockedCreateContext).toHaveBeenNthCalledWith(1, 'org-1');

    entitlementRepo.get.mockResolvedValueOnce(entitlement({ currentDocumentCount: 900 }));
    const resultOrg2 = await service.getUsage('org-2');
    expect(mockedCreateContext).toHaveBeenNthCalledWith(2, 'org-2');
    expect(resultOrg2.currentDocumentCount).toBe(900);
  });

  describe('toUsageResponse (defensive documentLimit handling)', () => {
    it('returns usagePercentage: null and remainingDocumentCount: 0 when documentLimit is 0 — never divides by zero', () => {
      const result = toUsageResponse(entitlement({ documentLimit: 0, currentDocumentCount: 0 }));

      expect(result.usagePercentage).toBeNull();
      expect(result.remainingDocumentCount).toBe(0);
      // currentDocumentCount (0) >= documentLimit (0) — no special case
      // needed for limitReached, the same comparison naturally handles it.
      expect(result.limitReached).toBe(true);
    });

    it('never returns a negative remainingDocumentCount even if currentDocumentCount somehow exceeds documentLimit', () => {
      const result = toUsageResponse(entitlement({ documentLimit: 100, currentDocumentCount: 105 }));

      expect(result.remainingDocumentCount).toBe(0);
      expect(result.limitReached).toBe(true);
    });
  });
});
