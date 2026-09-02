import { scoreTaxonomy } from './taxonomy';
import type { ClassificationFieldInput, ScoringInput } from '../types';

const now = new Date('2026-07-12T00:00:00Z');

function baseInput(classificationFields: ClassificationFieldInput[]): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Test.docx',
    sourceCreatedAt: new Date('2026-06-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    nextReviewDueAt: new Date('2099-01-01'),
    owners: [],
    siblingDocuments: [],
    classificationFields,
    now,
  };
}

function field(overrides: Partial<ClassificationFieldInput> = {}): ClassificationFieldInput {
  return { columnDefinitionId: 'c1', displayName: 'Department', populated: true, ...overrides };
}

describe('scoreTaxonomy', () => {
  it('scores a neutral 100 with no issue when no classification fields are configured (D=0)', () => {
    const result = scoreTaxonomy(baseInput([]));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('scores 100 with no issue when all configured fields are populated', () => {
    const result = scoreTaxonomy(
      baseInput([field({ columnDefinitionId: 'c1' }), field({ columnDefinitionId: 'c2', displayName: 'Function' })]),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('scores 0 and flags RequiresReview when none of the configured fields are populated', () => {
    const result = scoreTaxonomy(
      baseInput([
        field({ columnDefinitionId: 'c1', displayName: 'Department', populated: false }),
        field({ columnDefinitionId: 'c2', displayName: 'Function', populated: false }),
      ]),
    );
    expect(result.score).toBe(0);
    expect(result.issue?.type).toBe('Taxonomy');
    expect(result.issue?.severity).toBe('RequiresReview');
    expect(result.issue?.message).toContain('Department');
    expect(result.issue?.message).toContain('Function');
  });

  it('computes proportional coverage and rounds (2 of 3 populated -> 67, NeedsAttention)', () => {
    const result = scoreTaxonomy(
      baseInput([
        field({ columnDefinitionId: 'c1', populated: true }),
        field({ columnDefinitionId: 'c2', displayName: 'Function', populated: true }),
        field({ columnDefinitionId: 'c3', displayName: 'Region', populated: false }),
      ]),
    );
    expect(result.score).toBe(67);
    expect(result.issue?.severity).toBe('NeedsAttention');
    expect(result.issue?.message).toContain('Region');
    // Only the missing field is named, not the populated ones.
    expect(result.issue?.message).not.toContain('Department');
  });

  it('produces no issue once coverage reaches the 70 threshold (7 of 10 -> 70)', () => {
    const fields = Array.from({ length: 10 }, (_, i) => field({ columnDefinitionId: `c${i}`, populated: i < 7 }));
    const result = scoreTaxonomy(baseInput(fields));
    expect(result.score).toBe(70);
    expect(result.issue).toBeUndefined();
  });

  it('excludes stale fields from the denominator (caller passes only active fields)', () => {
    // The rule only ever sees active fields; a library whose only configured
    // field went stale is passed as D=0 here -> neutral 100, never penalized.
    const result = scoreTaxonomy(baseInput([]));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('is deterministic for the same input', () => {
    const input = baseInput([field({ columnDefinitionId: 'c1', populated: false })]);
    expect(scoreTaxonomy(input)).toEqual(scoreTaxonomy(input));
  });
});
