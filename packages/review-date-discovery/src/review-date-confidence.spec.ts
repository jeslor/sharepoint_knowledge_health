import type { GraphColumnDefinition } from '@sph/graph-client';
import { scoreReviewDateCandidateConfidence } from './review-date-confidence';

function column(name: string, displayName: string): GraphColumnDefinition {
  return { id: 'col-1', name, displayName, dateTime: {} };
}

describe('scoreReviewDateCandidateConfidence', () => {
  it('scores a column whose name mentions "review" as high confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('ReviewDate', 'Review Date'))).toBe('high');
  });

  it('scores a column whose displayName mentions "review" (even if the internal name does not) as high confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('NextCheck', 'Next Review'))).toBe('high');
  });

  it('scores an expiry-related column as medium confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('ExpiryDate', 'Expiry Date'))).toBe('medium');
  });

  it('scores a renewal-related column as medium confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('RenewalDate', 'Renewal Date'))).toBe('medium');
  });

  it('scores a due-date column as medium confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('DueDate', 'Due Date'))).toBe('medium');
  });

  it('scores an unrelated dateTime column as low confidence', () => {
    expect(scoreReviewDateCandidateConfidence(column('EventDate', 'Event Date'))).toBe('low');
  });

  it('is case-insensitive', () => {
    expect(scoreReviewDateCandidateConfidence(column('REVIEWDATE', 'REVIEW DATE'))).toBe('high');
  });
});
