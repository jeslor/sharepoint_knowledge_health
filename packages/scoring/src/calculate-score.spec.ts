import { calculateScore } from './calculate-score';
import { SCORING_WEIGHTS } from './config';
import type { ScoringInput } from './types';

const now = new Date('2026-07-12T00:00:00Z');
const FUTURE_REVIEW_DATE = new Date('2026-09-01T00:00:00Z'); // after `now` above -> Healthy

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Employee Handbook.docx',
    sourceCreatedAt: new Date('2026-06-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 100_000,
    nextReviewDueAt: FUTURE_REVIEW_DATE,
    owners: [{ email: 'hr@example.com', isActiveUser: true }],
    siblingDocuments: [],
    classificationFields: [],
    now,
    ...overrides,
  };
}

describe('calculateScore', () => {
  it('scores a fully healthy document at 100 with no issues', () => {
    const result = calculateScore(baseInput());
    expect(result.score).toBe(100);
    expect(result.band).toBe('Healthy');
    expect(result.issues).toEqual([]);
  });

  it('reproduces the documented example: a stale document with no review date scores low and explains why', () => {
    // Matches the shape of the "Employee Handbook.docx" example from the
    // Phase 5 task: missing review date is the dominant, explainable issue.
    const result = calculateScore(
      baseInput({
        nextReviewDueAt: null,
        sourceModifiedAt: new Date('2020-01-01'), // also stale
      }),
    );

    expect(result.score).toBeLessThan(70);
    expect(result.band).toBe('RequiresReview');

    const reviewIssue = result.issues.find((issue) => issue.type === 'ReviewStatus');
    expect(reviewIssue).toEqual({
      type: 'ReviewStatus',
      severity: 'RequiresReview',
      message: 'Document has no scheduled review date.',
    });
  });

  it('is deterministic — identical input always produces identical output', () => {
    const input = baseInput();
    expect(calculateScore(input)).toEqual(calculateScore(input));
  });

  it('produces a full breakdown covering all seven criteria', () => {
    const result = calculateScore(baseInput());
    expect(Object.keys(result.breakdown).sort()).toEqual(
      ['Age', 'Duplication', 'Freshness', 'Metadata', 'Ownership', 'ReviewStatus', 'Taxonomy'].sort(),
    );
  });

  it('applies the approved ADR-0025 weights, which still sum to exactly 1.0', () => {
    const total =
      SCORING_WEIGHTS.Freshness +
      SCORING_WEIGHTS.Ownership +
      SCORING_WEIGHTS.ReviewStatus +
      SCORING_WEIGHTS.Metadata +
      SCORING_WEIGHTS.Duplication +
      SCORING_WEIGHTS.Age +
      SCORING_WEIGHTS.Taxonomy;
    expect(total).toBeCloseTo(1, 10);
    expect(SCORING_WEIGHTS.Taxonomy).toBe(0.1);
  });

  it('lowers the composite by Taxonomy weight when classification coverage is partial', () => {
    // One of two configured fields populated -> Taxonomy 50; everything else
    // healthy. 100 - (100-50)*0.10 = 95.
    const result = calculateScore(
      baseInput({
        classificationFields: [
          { columnDefinitionId: 'c1', displayName: 'Department', populated: true },
          { columnDefinitionId: 'c2', displayName: 'Function', populated: false },
        ],
      }),
    );
    expect(result.breakdown.Taxonomy).toBe(50);
    expect(result.score).toBe(95);
    expect(result.issues.map((i) => i.type)).toContain('Taxonomy');
  });

  it('leaves the composite unchanged when no classification fields are configured (neutral 100)', () => {
    const result = calculateScore(baseInput({ classificationFields: [] }));
    expect(result.breakdown.Taxonomy).toBe(100);
    expect(result.issues.map((i) => i.type)).not.toContain('Taxonomy');
  });

  it('surfaces one issue per failing criterion, not just the worst one', () => {
    const result = calculateScore(
      baseInput({
        nextReviewDueAt: null,
        owners: [],
        sourceModifiedAt: new Date('2019-01-01'),
      }),
    );

    const issueTypes = result.issues.map((issue) => issue.type).sort();
    expect(issueTypes).toEqual(['Freshness', 'Ownership', 'ReviewStatus'].sort());
  });

  it('classifies composite bands correctly at the documented thresholds', () => {
    expect(calculateScore(baseInput()).band).toBe('Healthy'); // 100

    const needsAttention = calculateScore(baseInput({ nextReviewDueAt: null })); // -15 weight -> 85
    expect(needsAttention.score).toBe(85);
    expect(needsAttention.band).toBe('NeedsAttention');

    const requiresReview = calculateScore(baseInput({ nextReviewDueAt: null, owners: [] })); // -15 -20 -> 65
    expect(requiresReview.score).toBe(65);
    expect(requiresReview.band).toBe('RequiresReview');
  });
});
