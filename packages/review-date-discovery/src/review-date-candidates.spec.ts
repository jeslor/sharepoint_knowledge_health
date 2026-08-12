import type { GraphColumnDefinition } from '@sph/graph-client';
import { resolveReviewDateCandidates } from './review-date-candidates';

function dateColumn(id: string, name: string, overrides: Partial<GraphColumnDefinition> = {}): GraphColumnDefinition {
  return { id, name, displayName: name, dateTime: {}, ...overrides };
}

function textColumn(id: string, name: string): GraphColumnDefinition {
  return { id, name, displayName: name };
}

describe('resolveReviewDateCandidates', () => {
  it('returns no candidates when there are no dateTime columns', () => {
    const result = resolveReviewDateCandidates([textColumn('col-1', 'Title')], []);
    expect(result).toEqual([]);
  });

  it('returns exactly one candidate when exactly one dateTime column exists', () => {
    const result = resolveReviewDateCandidates([textColumn('col-1', 'Title'), dateColumn('col-2', 'ReviewDate')], []);
    expect(result.map((c) => c.id)).toEqual(['col-2']);
  });

  it('returns multiple candidates when multiple genuine custom dateTime columns exist — never picks one for the caller', () => {
    const result = resolveReviewDateCandidates(
      [dateColumn('col-1', 'ReviewDate'), dateColumn('col-2', 'ExpiryDate'), textColumn('col-3', 'Title')],
      [],
    );
    expect(result.map((c) => c.id).sort()).toEqual(['col-1', 'col-2']);
  });

  it('never uses displayName/name to filter — a text column named "Review Date" is excluded', () => {
    const result = resolveReviewDateCandidates([{ id: 'col-1', name: 'ReviewDate', displayName: 'Review Date' }], []);
    expect(result).toEqual([]);
  });

  it('includes a dateTime column found only via content-type union', () => {
    const result = resolveReviewDateCandidates([textColumn('col-1', 'Title')], [dateColumn('col-2', 'NextReview')]);
    expect(result.map((c) => c.id)).toEqual(['col-2']);
  });

  it('deduplicates a column present in both list columns and content-type columns by id', () => {
    const listColumns = [dateColumn('col-1', 'ReviewDate')];
    const contentTypeColumns = [dateColumn('col-1', 'ReviewDate')];

    const result = resolveReviewDateCandidates(listColumns, contentTypeColumns);

    expect(result).toHaveLength(1);
  });

  it('treats a hidden dateTime column as a valid candidate — hidden is not a disqualifier', () => {
    const result = resolveReviewDateCandidates([dateColumn('col-1', 'ReviewDate', { hidden: true })], []);
    expect(result).toHaveLength(1);
  });

  describe('system-column exclusion (Phase 1.1 — Layer 2)', () => {
    it('excludes Created despite carrying the dateTime facet', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'Created')], []);
      expect(result).toEqual([]);
    });

    it('excludes Modified despite carrying the dateTime facet', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'Modified')], []);
      expect(result).toEqual([]);
    });

    it('resolves exactly one eligible candidate for {Created, Modified, ReviewDate} — the exact live-validation scenario', () => {
      const result = resolveReviewDateCandidates(
        [dateColumn('col-1', 'Created'), dateColumn('col-2', 'Modified'), dateColumn('col-3', 'ReviewDate')],
        [],
      );
      expect(result.map((c) => c.id)).toEqual(['col-3']);
    });

    it('excludes any column with isDeletable: false regardless of name — the signal generalizes beyond Created/Modified', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'SomeSystemDate', { isDeletable: false })], []);
      expect(result).toEqual([]);
    });

    it('does not exclude a customer-created dateTime column with isDeletable: true', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'ReviewDate', { isDeletable: true })], []);
      expect(result).toHaveLength(1);
    });

    it('does not exclude a dateTime column when isDeletable is undefined (defensive default — absent never means excluded)', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'ReviewDate')], []);
      expect(result).toHaveLength(1);
    });

    it('reports zero eligible candidates when only system columns are present', () => {
      const result = resolveReviewDateCandidates([dateColumn('col-1', 'Created'), dateColumn('col-2', 'Modified')], []);
      expect(result).toEqual([]);
    });

    it('excludes a system column even when it is only surfaced via content-type union', () => {
      const result = resolveReviewDateCandidates([], [dateColumn('col-1', 'Created')]);
      expect(result).toEqual([]);
    });
  });
});
