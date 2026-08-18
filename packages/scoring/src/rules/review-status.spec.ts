import { classifyReviewDateHealth, scoreReviewStatus } from './review-status';
import type { ScoringInput } from '../types';

const NOW = new Date('2026-08-13T12:00:00.000Z');

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Employee Handbook.docx',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    nextReviewDueAt: null,
    owners: [],
    siblingDocuments: [],
    now: NOW,
    ...overrides,
  };
}

describe('scoreReviewStatus', () => {
  describe('Missing', () => {
    it('scores 0 and flags RequiresReview when there is no scheduled review date', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: null }));
      expect(result.score).toBe(0);
      expect(result.issue).toEqual({
        type: 'ReviewStatus',
        severity: 'RequiresReview',
        message: 'Document has no scheduled review date.',
      });
    });
  });

  describe('Overdue', () => {
    it('scores 50 and flags NeedsAttention when the review date is in the past', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date('2026-08-01T00:00:00.000Z') }));
      expect(result.score).toBe(50);
      expect(result.issue).toEqual({
        type: 'ReviewStatus',
        severity: 'NeedsAttention',
        message: 'Document review date has passed.',
      });
    });

    it('scores Overdue worse than Healthy but better than Missing, preserving the severity ordering', () => {
      const missing = scoreReviewStatus(baseInput({ nextReviewDueAt: null }));
      const overdue = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date('2026-01-01T00:00:00.000Z') }));
      const healthy = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date('2027-01-01T00:00:00.000Z') }));
      expect(missing.score).toBeLessThan(overdue.score);
      expect(overdue.score).toBeLessThan(healthy.score);
    });

    it('a review date exactly one millisecond in the past is Overdue', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date(NOW.getTime() - 1) }));
      expect(result.score).toBe(50);
      expect(result.issue?.message).toBe('Document review date has passed.');
    });
  });

  describe('Healthy', () => {
    it('scores 100 with no issue when the review date is in the future', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date('2027-01-01T00:00:00.000Z') }));
      expect(result.score).toBe(100);
      expect(result.issue).toBeUndefined();
    });

    it('a review date exactly equal to now is Healthy, not Overdue (boundary is exclusive on the past side)', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date(NOW.getTime()) }));
      expect(result.score).toBe(100);
      expect(result.issue).toBeUndefined();
    });

    it('a review date one millisecond in the future is Healthy', () => {
      const result = scoreReviewStatus(baseInput({ nextReviewDueAt: new Date(NOW.getTime() + 1) }));
      expect(result.score).toBe(100);
    });
  });

  describe('now handling', () => {
    it('uses input.now, never the real current time, for deterministic scoring', () => {
      // A review date in the real past relative to actual "today" but in
      // the future relative to the injected `now` must score Healthy —
      // proves the rule never calls `new Date()` itself.
      const result = scoreReviewStatus(
        baseInput({ nextReviewDueAt: new Date('2020-06-01T00:00:00.000Z'), now: new Date('2020-01-01T00:00:00.000Z') }),
      );
      expect(result.score).toBe(100);
    });

    it('falls back to the real current time when now is omitted (documented ScoringInput behavior, not called from inside the rule)', () => {
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const input = baseInput({ nextReviewDueAt: farFuture });
      delete (input as { now?: Date }).now;
      const result = scoreReviewStatus(input);
      expect(result.score).toBe(100);
    });
  });

  describe('timezone safety', () => {
    it('compares absolute instants, not wall-clock dates — a review date "later today" in UTC but already past in a positive-offset zone is still judged by the instant, not a calendar date string', () => {
      // now = 2026-08-13T23:30:00Z. A review date of 2026-08-13T23:45:00Z
      // is still in the future as an instant, regardless of what calendar
      // day it is in any particular timezone.
      const lateNow = new Date('2026-08-13T23:30:00.000Z');
      const result = scoreReviewStatus(
        baseInput({ nextReviewDueAt: new Date('2026-08-13T23:45:00.000Z'), now: lateNow }),
      );
      expect(result.score).toBe(100);
    });

    it('a review date that has passed as an instant is Overdue even if it is still "today" in a negative-offset timezone', () => {
      const lateNow = new Date('2026-08-13T23:30:00.000Z');
      const result = scoreReviewStatus(
        baseInput({ nextReviewDueAt: new Date('2026-08-13T10:00:00.000Z'), now: lateNow }),
      );
      expect(result.score).toBe(50);
    });
  });
});

describe('classifyReviewDateHealth', () => {
  it('classifies null as Missing', () => {
    expect(classifyReviewDateHealth(null, NOW)).toBe('Missing');
  });

  it('classifies a past date as Overdue', () => {
    expect(classifyReviewDateHealth(new Date('2026-08-01T00:00:00.000Z'), NOW)).toBe('Overdue');
  });

  it('classifies a date within the default 30-day window as DueSoon', () => {
    expect(classifyReviewDateHealth(new Date('2026-08-20T12:00:00.000Z'), NOW)).toBe('DueSoon'); // 7 days out
  });

  it('classifies a date exactly at the 30-day boundary as DueSoon (inclusive)', () => {
    const exactlyThirtyDaysOut = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(classifyReviewDateHealth(exactlyThirtyDaysOut, NOW)).toBe('DueSoon');
  });

  it('classifies a date one day beyond the 30-day window as Healthy', () => {
    const thirtyOneDaysOut = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(classifyReviewDateHealth(thirtyOneDaysOut, NOW)).toBe('Healthy');
  });

  it('classifies a far-future date as Healthy', () => {
    expect(classifyReviewDateHealth(new Date('2030-01-01T00:00:00.000Z'), NOW)).toBe('Healthy');
  });

  it('accepts a custom due-soon window', () => {
    const sevenDaysOut = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
    expect(classifyReviewDateHealth(sevenDaysOut, NOW, 30)).toBe('DueSoon');
    expect(classifyReviewDateHealth(sevenDaysOut, NOW, 5)).toBe('Healthy');
  });

  it('never returns DueSoon for an overdue date, regardless of window size', () => {
    const oneDayPast = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(classifyReviewDateHealth(oneDayPast, NOW, 365)).toBe('Overdue');
  });
});
