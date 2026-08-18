import { scoreOwnership } from './ownership';
import type { ScoringInput } from '../types';

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Test.docx',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    nextReviewDueAt: new Date('2099-01-01'),
    owners: [],
    siblingDocuments: [],
    ...overrides,
  };
}

describe('scoreOwnership', () => {
  it('scores 0 and flags RequiresReview when there is no identifiable owner', () => {
    const result = scoreOwnership(baseInput({ owners: [] }));
    expect(result.score).toBe(0);
    expect(result.issue?.type).toBe('Ownership');
    expect(result.issue?.severity).toBe('RequiresReview');
  });

  it('scores 0 when the only owner entries have no email', () => {
    const result = scoreOwnership(baseInput({ owners: [{ email: null, isActiveUser: null }] }));
    expect(result.score).toBe(0);
  });

  it('scores 100 when an identifiable owner exists and activity cannot be resolved', () => {
    const result = scoreOwnership(baseInput({ owners: [{ email: 'author@example.com', isActiveUser: null }] }));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('flags an issue when every resolvable owner is inactive', () => {
    const result = scoreOwnership(baseInput({ owners: [{ email: 'former@example.com', isActiveUser: false }] }));
    expect(result.score).toBe(40);
    expect(result.issue?.type).toBe('Ownership');
    expect(result.issue?.message).toMatch(/no longer an active user/i);
  });

  it('does not flag an issue when at least one resolvable owner is active', () => {
    const result = scoreOwnership(
      baseInput({
        owners: [
          { email: 'former@example.com', isActiveUser: false },
          { email: 'current@example.com', isActiveUser: true },
        ],
      }),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });
});
