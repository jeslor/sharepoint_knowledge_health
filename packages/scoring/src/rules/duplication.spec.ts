import { scoreDuplication } from './duplication';
import type { ScoringInput } from '../types';

function baseInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    documentId: 'doc-1',
    documentName: 'Report.pdf',
    sourceCreatedAt: new Date('2026-01-01'),
    sourceModifiedAt: new Date('2026-06-01'),
    sizeBytes: 5000,
    nextReviewDueAt: new Date('2099-01-01'),
    owners: [],
    siblingDocuments: [],
    classificationFields: [],
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

  it('flags a duplicate when only case differs, same size (name normalization)', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: 'REPORT.PDF', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(30);
    expect(result.issue?.type).toBe('Duplication');
  });

  it('flags a duplicate when only whitespace differs, same size (name normalization)', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: '  Report.pdf  ', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(30);
    expect(result.issue?.type).toBe('Duplication');
  });

  it('flags a duplicate when underscores/hyphens stand in for spaces, same size (name normalization)', () => {
    const result = scoreDuplication(
      baseInput({ documentName: 'Meeting Notes.docx', siblingDocuments: [{ id: 'doc-2', name: 'Meeting_Notes.docx', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(30);
    expect(result.issue?.type).toBe('Duplication');
  });

  it('does not treat same apparent base name with different extensions and different sizes as a duplicate (deliberately out of scope — cross-format matching needs stronger evidence)', () => {
    // Mirrors a real live-data example: "...Part B.docx" (20958 bytes) vs
    // "...Part B.pdf" (26486 bytes) — same normalized base name, different
    // extension and size. Not flagged: relaxing the exact sizeBytes match
    // to catch this would reintroduce false positives with no signal to
    // rule them out (see duplication.ts's header comment).
    const result = scoreDuplication(
      baseInput({
        documentName: 'Part B.docx',
        sizeBytes: 20958,
        siblingDocuments: [{ id: 'doc-2', name: 'Part B.pdf', sizeBytes: 26486 }],
      }),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('does not treat a same-normalized-name, same-extension, different-size document as a duplicate', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-2', name: 'REPORT.PDF', sizeBytes: 9999 }] }),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });

  it('never treats the document as a duplicate of itself, even after normalization', () => {
    const result = scoreDuplication(
      baseInput({ siblingDocuments: [{ id: 'doc-1', name: '  REPORT.pdf  ', sizeBytes: 5000 }] }),
    );
    expect(result.score).toBe(100);
    expect(result.issue).toBeUndefined();
  });
});
