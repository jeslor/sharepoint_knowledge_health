import { scoreFreshness } from './freshness';
import type { ScoringInput } from '../types';

const now = new Date('2026-07-12T00:00:00Z');

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Test.docx',
    sourceCreatedAt: new Date('2020-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    nextReviewDueAt: new Date('2099-01-01'),
    owners: [],
    siblingDocuments: [],
    classificationFields: [],
    now,
    ...overrides,
  };
}

describe('scoreFreshness', () => {
  it('scores 100 with no issue when modified within the full-score window', () => {
    const result = scoreFreshness(baseInput({ sourceModifiedAt: new Date('2026-06-01') }));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('scores 0 and flags RequiresReview when modified well over 2 years ago', () => {
    const result = scoreFreshness(baseInput({ sourceModifiedAt: new Date('2018-01-01') }));
    expect(result.score).toBe(0);
    expect(result.issue?.type).toBe('Freshness');
    expect(result.issue?.severity).toBe('RequiresReview');
  });

  it('produces no issue once the score recovers to the 70 threshold', () => {
    const result = scoreFreshness(baseInput({ sourceModifiedAt: new Date('2026-04-01') }));
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.issue).toBeUndefined();
  });

  it('is deterministic for the same input', () => {
    const input = baseInput();
    expect(scoreFreshness(input)).toEqual(scoreFreshness(input));
  });
});
