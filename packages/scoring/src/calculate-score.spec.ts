import { calculateScore } from './calculate-score';
import type { ScoringInput } from './types';

const now = new Date('2026-07-12T00:00:00Z');

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Employee Handbook.docx',
    sourceCreatedAt: new Date('2026-06-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 100_000,
    hasReviewDate: true,
    owners: [{ email: 'hr@example.com', isActiveUser: true }],
    siblingDocuments: [],
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
        hasReviewDate: false,
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

  it('produces a full breakdown covering all six criteria', () => {
    const result = calculateScore(baseInput());
    expect(Object.keys(result.breakdown).sort()).toEqual(
      ['Age', 'Duplication', 'Freshness', 'Metadata', 'Ownership', 'ReviewStatus'].sort(),
    );
  });

  it('surfaces one issue per failing criterion, not just the worst one', () => {
    const result = calculateScore(
      baseInput({
        hasReviewDate: false,
        owners: [],
        sourceModifiedAt: new Date('2019-01-01'),
      }),
    );

    const issueTypes = result.issues.map((issue) => issue.type).sort();
    expect(issueTypes).toEqual(['Freshness', 'Ownership', 'ReviewStatus'].sort());
  });

  it('classifies composite bands correctly at the documented thresholds', () => {
    expect(calculateScore(baseInput()).band).toBe('Healthy'); // 100

    const needsAttention = calculateScore(baseInput({ hasReviewDate: false })); // -15 weight -> 85
    expect(needsAttention.score).toBe(85);
    expect(needsAttention.band).toBe('NeedsAttention');

    const requiresReview = calculateScore(baseInput({ hasReviewDate: false, owners: [] })); // -15 -20 -> 65
    expect(requiresReview.score).toBe(65);
    expect(requiresReview.band).toBe('RequiresReview');
  });
});
