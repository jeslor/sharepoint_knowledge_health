import { scoreDuplication } from './duplication';
import type { ScoringInput } from '../types';

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Report.pdf',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 5000,
    hasReviewDate: true,
    owners: [],
    siblingDocuments: [],
    ...overrides,
  };
}

describe('scoreDuplication', () => {
  it('scores 100 with no issue when no sibling matches name and size', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: 'Different.pdf', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('flags a duplicate when a sibling has the same name and size', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: 'Report.pdf', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(30);
    expect(result.issue?.type).toBe('Duplication');
  });

  it('does not treat a same-name, different-size document as a duplicate (exact match only, ADR-0005)', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: 'Report.pdf', sizeBytes: 9999 }] }),
    );
    expect(result.score).toBe(100);
  });

  it('never treats the document as a duplicate of itself', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-1', name: 'Report.pdf', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(100);
  });
});
