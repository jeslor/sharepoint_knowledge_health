import { buildScoringInput } from './build-scoring-input';

const now = new Date('2026-12-01T00:00:00.000Z');

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    name: 'Report.docx',
    sourceCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
    sourceModifiedAt: new Date('2025-06-01T00:00:00.000Z'),
    sizeBytes: BigInt(2048),
    nextReviewDueAt: null,
    ...overrides,
  } as never;
}

describe('buildScoringInput (ADR-0022 Phase 5 — shared with the full-scan path)', () => {
  it('maps document fields directly, converting sizeBytes from BigInt to Number', () => {
    const input = buildScoringInput(makeDocument(), [], new Map(), [], now);

    expect(input).toEqual({
      documentId: 'doc-1',
      documentName: 'Report.docx',
      sourceCreatedAt: new Date('2025-01-01T00:00:00.000Z'),
      sourceModifiedAt: new Date('2025-06-01T00:00:00.000Z'),
      sizeBytes: 2048,
      nextReviewDueAt: null,
      owners: [],
      siblingDocuments: [],
      now,
    });
  });

  it('maps an owner with a null email to isActiveUser: null (unresolvable)', () => {
    const input = buildScoringInput(makeDocument(), [{ email: null }], new Map(), [], now);

    expect(input.owners).toEqual([{ email: null, isActiveUser: null }]);
  });

  it('resolves isActiveUser: true/false for an owner whose email matches the activeByEmail map', () => {
    const activeByEmail = new Map([
      ['active@example.com', true],
      ['inactive@example.com', false],
    ]);

    const input = buildScoringInput(
      makeDocument(),
      [{ email: 'active@example.com' }, { email: 'inactive@example.com' }],
      activeByEmail,
      [],
      now,
    );

    expect(input.owners).toEqual([
      { email: 'active@example.com', isActiveUser: true },
      { email: 'inactive@example.com', isActiveUser: false },
    ]);
  });

  it('resolves isActiveUser: null for an owner with an email that has no registered User match', () => {
    const input = buildScoringInput(makeDocument(), [{ email: 'unregistered@example.com' }], new Map(), [], now);

    expect(input.owners).toEqual([{ email: 'unregistered@example.com', isActiveUser: null }]);
  });

  it('passes siblingDocuments through unmodified — this function never filters/computes duplicates itself', () => {
    const siblings = [{ id: 'doc-2', name: 'Report.docx', sizeBytes: 2048 }];

    const input = buildScoringInput(makeDocument(), [], new Map(), siblings, now);

    expect(input.siblingDocuments).toBe(siblings);
  });

  it('passes nextReviewDueAt through unmodified when set', () => {
    const dueDate = new Date('2027-01-01T00:00:00.000Z');
    const input = buildScoringInput(makeDocument({ nextReviewDueAt: dueDate }), [], new Map(), [], now);

    expect(input.nextReviewDueAt).toBe(dueDate);
  });
});
