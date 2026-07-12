import { scoreReviewStatus } from './review-status';
import type { ScoringInput } from '../types';

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Employee Handbook.docx',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    hasReviewDate: false,
    owners: [],
    siblingDocuments: [],
    ...overrides,
  };
}

describe('scoreReviewStatus', () => {
  it('scores 0 and flags RequiresReview when there is no scheduled review date', () => {
    const result = scoreReviewStatus(baseInput({ hasReviewDate: false }));
    expect(result.score).toBe(0);
    expect(result.issue).toEqual({
      type: 'ReviewStatus',
      severity: 'RequiresReview',
      message: 'Document has no scheduled review date.',
    });
  });

  it('scores 100 with no issue when a review date is scheduled', () => {
    const result = scoreReviewStatus(baseInput({ hasReviewDate: true }));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });
});
