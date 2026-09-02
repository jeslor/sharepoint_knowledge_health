import { scoreAge } from './age';
import type { ScoringInput } from '../types';

const now = new Date('2026-07-12T00:00:00Z');

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Test.docx',
    sourceCreatedAt: new Date('2026-06-01'),
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

describe('scoreAge', () => {
  it('scores 100 for a document created recently', () => {
    const result = scoreAge(baseInput({ sourceCreatedAt: new Date('2026-06-01') }));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('scores 0 and flags RequiresReview for a document 5+ years old', () => {
    const result = scoreAge(baseInput({ sourceCreatedAt: new Date('2015-01-01') }));
    expect(result.score).toBe(0);
    expect(result.issue?.type).toBe('Age');
    expect(result.issue?.severity).toBe('RequiresReview');
  });

  it('is independent of Freshness — an old but recently-modified document still scores low here', () => {
    const result = scoreAge(baseInput({ sourceCreatedAt: new Date('2015-01-01'), sourceModifiedAt: new Date('2026-07-01') }));
    expect(result.score).toBeLessThan(70);
  });
});
