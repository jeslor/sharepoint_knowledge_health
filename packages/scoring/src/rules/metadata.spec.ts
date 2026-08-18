import { scoreMetadata } from './metadata';
import type { ScoringInput } from '../types';

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Employee Handbook.docx',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 1000,
    nextReviewDueAt: new Date('2099-01-01'),
    owners: [],
    siblingDocuments: [],
    ...overrides,
  };
}

describe('scoreMetadata', () => {
  it.each(['Untitled.docx', 'New Document.docx', 'Document1.docx', 'Copy of Report.xlsx'])(
    'flags a placeholder-looking name: %s',
    (documentName) => {
      const result = scoreMetadata(baseInput({ documentName }));
      expect(result.score).toBeLessThan(70);
      expect(result.issue?.type).toBe('Metadata');
    },
  );

  it('scores 100 with no issue for a meaningfully-named document', () => {
    const result = scoreMetadata(baseInput({ documentName: 'Employee Handbook.docx' }));
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });
});
