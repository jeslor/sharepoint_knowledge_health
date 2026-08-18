import type { GraphColumnDefinition } from '@sph/graph-client';
import { scoreReviewDateCandidateConfidence } from './review-date-confidence';

function column(name: string, displayName: string): GraphColumnDefinition {
  return { id: 'col-1', name, displayName, dateTime: {} };
}

describe('scoreReviewDateCandidateConfidence', () => {
  describe('high confidence — realistic review-date naming variants', () => {
    it.each([
      ['ReviewDate', 'Review Date'],
      ['reviewDate', 'Review Date'],
      ['Review_Date', 'Review Date'],
      ['review_date', 'review date'],
      ['DateForReview', 'Date for Review'],
      ['DocumentReviewDate', 'Document Review Date'],
      ['ReviewDueDate', 'Review Due Date'],
      ['DateToReview', 'Date To Review'],
      ['ReviewDeadline', 'Review Deadline'],
    ])('scores %s / %s as high', (name, displayName) => {
      expect(scoreReviewDateCandidateConfidence(column(name, displayName))).toBe('high');
    });

    it('scores a column whose displayName mentions "review" (even if the internal name does not) as high confidence', () => {
      expect(scoreReviewDateCandidateConfidence(column('NextCheck', 'Next Review'))).toBe('high');
    });

    it('is case-insensitive', () => {
      expect(scoreReviewDateCandidateConfidence(column('REVIEWDATE', 'REVIEW DATE'))).toBe('high');
    });

    it('handles hyphens the same as underscores and spaces', () => {
      expect(scoreReviewDateCandidateConfidence(column('Review-Date', 'Review-Date'))).toBe('high');
    });

    it('handles irregular/extra punctuation and whitespace consistently', () => {
      expect(scoreReviewDateCandidateConfidence(column('Review..Date', '  Review   Date  '))).toBe('high');
    });
  });

  describe('ambiguous — "review" present with no date-indicator word, never silently treated as high', () => {
    it('scores "Document Review" (no date/due/deadline word) as ambiguous, not high', () => {
      expect(scoreReviewDateCandidateConfidence(column('DocumentReview', 'Document Review'))).toBe('ambiguous');
    });

    it('scores a bare "Review" column as ambiguous', () => {
      expect(scoreReviewDateCandidateConfidence(column('Review', 'Review'))).toBe('ambiguous');
    });

    it('scores "Peer Review" as ambiguous', () => {
      expect(scoreReviewDateCandidateConfidence(column('PeerReview', 'Peer Review'))).toBe('ambiguous');
    });

    it('scores "Review Status" as ambiguous', () => {
      expect(scoreReviewDateCandidateConfidence(column('ReviewStatus', 'Review Status'))).toBe('ambiguous');
    });
  });

  describe('medium confidence — expiry/renewal/due/deadline without "review"', () => {
    it('scores an expiry-related column as medium confidence', () => {
      expect(scoreReviewDateCandidateConfidence(column('ExpiryDate', 'Expiry Date'))).toBe('medium');
    });

    it('scores a renewal-related column as medium confidence', () => {
      expect(scoreReviewDateCandidateConfidence(column('RenewalDate', 'Renewal Date'))).toBe('medium');
    });

    it('scores a due-date column as medium confidence', () => {
      expect(scoreReviewDateCandidateConfidence(column('DueDate', 'Due Date'))).toBe('medium');
    });
  });

  describe('low confidence — unrelated dateTime columns', () => {
    it('scores an unrelated dateTime column as low confidence', () => {
      expect(scoreReviewDateCandidateConfidence(column('EventDate', 'Event Date'))).toBe('low');
    });

    it('never confuses "Preview Date" with "Review Date" — the one realistic false-positive substring', () => {
      expect(scoreReviewDateCandidateConfidence(column('PreviewDate', 'Preview Date'))).toBe('low');
    });

    it('still correctly finds a genuine "review" occurrence even alongside an unrelated "preview" occurrence', () => {
      expect(scoreReviewDateCandidateConfidence(column('PreviewAndReviewDate', 'Preview and Review Date'))).toBe(
        'high',
      );
    });
  });

  describe('safety — confidence never widens what counts as a candidate at all', () => {
    it('system columns are never scored here in practice — they are excluded upstream by resolveReviewDateCandidates before confidence is ever computed', () => {
      // Documents this function's contract rather than re-testing
      // resolveReviewDateCandidates's own exclusion (covered in
      // review-date-candidates.spec.ts) — Created/Modified never reach
      // this function in the real eligibility flow.
      expect(scoreReviewDateCandidateConfidence(column('Modified', 'Modified'))).toBe('low');
      expect(scoreReviewDateCandidateConfidence(column('Created', 'Created'))).toBe('low');
    });
  });
});
