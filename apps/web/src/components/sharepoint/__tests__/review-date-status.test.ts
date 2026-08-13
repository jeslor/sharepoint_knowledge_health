import {
  deriveReviewDateLibraryStatus,
  reviewDateStatusExplanation,
  REVIEW_DATE_STATUS_LABEL,
  REVIEW_DATE_STATUS_TONE,
  NO_ELIGIBLE_COLUMN_GUIDANCE,
  CONFIRM_OVERWRITE_WARNING,
} from '../review-date-status';

const activeMapping = {
  id: 'mapping-1',
  siteId: 'site-1',
  graphListId: 'list-1',
  columnDefinitionId: 'col-1',
  columnDisplayName: 'Review Date',
  status: 'Active',
  confirmedByUserId: 'user-1',
  confirmedByDisplayName: 'Alice Admin',
  confirmedAt: '2026-08-12T00:00:00.000Z',
};

const staleMapping = { ...activeMapping, status: 'Stale' };

describe('deriveReviewDateLibraryStatus — the mental model', () => {
  it('NO MAPPING + not checked → NotChecked (never confused with NoEligibleColumn)', () => {
    expect(deriveReviewDateLibraryStatus(null, undefined)).toEqual({ kind: 'NotChecked' });
  });

  it('NO MAPPING + checked, nothing eligible → NoEligibleColumn (distinct from NotChecked)', () => {
    expect(deriveReviewDateLibraryStatus(null, { status: 'NoEligibleColumn' })).toEqual({ kind: 'NoEligibleColumn' });
  });

  it('NO MAPPING + checked, one candidate → SingleEligibleColumn, carries the candidate', () => {
    const eligibility = {
      status: 'SingleEligibleColumn' as const,
      column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' as const },
    };
    expect(deriveReviewDateLibraryStatus(null, eligibility)).toEqual({ kind: 'SingleEligibleColumn', eligibility });
  });

  it('NO MAPPING + checked, multiple candidates → MultipleEligibleColumns, carries all candidates', () => {
    const eligibility = {
      status: 'MultipleEligibleColumns' as const,
      columns: [
        { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' as const },
        { id: 'col-2', name: 'ExpiryDate', displayName: 'Expiry Date', confidence: 'medium' as const },
      ],
    };
    expect(deriveReviewDateLibraryStatus(null, eligibility)).toEqual({ kind: 'MultipleEligibleColumns', eligibility });
  });

  it('ACTIVE MAPPING → Active, regardless of whether an eligibility check was ever run', () => {
    expect(deriveReviewDateLibraryStatus(activeMapping, undefined)).toEqual({ kind: 'Active', mapping: activeMapping });
    expect(deriveReviewDateLibraryStatus(activeMapping, { status: 'NoEligibleColumn' })).toEqual({
      kind: 'Active',
      mapping: activeMapping,
    });
  });

  it('STALE MAPPING → Stale, takes precedence over any eligibility check result', () => {
    expect(deriveReviewDateLibraryStatus(staleMapping, undefined)).toEqual({ kind: 'Stale', mapping: staleMapping });
  });

  it('a mapping always takes precedence over a stale/unrelated eligibility result — never contradicts confirmed state', () => {
    const eligibility = { status: 'MultipleEligibleColumns' as const, columns: [] };
    expect(deriveReviewDateLibraryStatus(activeMapping, eligibility)).toEqual({ kind: 'Active', mapping: activeMapping });
  });
});

describe('status label/tone/explanation — every kind has distinct, non-generic text', () => {
  const kinds: (keyof typeof REVIEW_DATE_STATUS_LABEL)[] = [
    'NotChecked',
    'NoEligibleColumn',
    'SingleEligibleColumn',
    'MultipleEligibleColumns',
    'Active',
    'Stale',
  ];

  it('every kind has a label that is not just the raw enum value', () => {
    for (const kind of kinds) {
      expect(REVIEW_DATE_STATUS_LABEL[kind]).not.toBe(kind);
      expect(REVIEW_DATE_STATUS_LABEL[kind].length).toBeGreaterThan(0);
    }
  });

  it('Active and Stale never share the same tone — success vs critical must be visually distinct', () => {
    expect(REVIEW_DATE_STATUS_TONE.Active).toBe('success');
    expect(REVIEW_DATE_STATUS_TONE.Stale).toBe('critical');
  });

  it('NotChecked and NoEligibleColumn never share the same label, even though both are neutral-toned', () => {
    expect(REVIEW_DATE_STATUS_LABEL.NotChecked).not.toBe(REVIEW_DATE_STATUS_LABEL.NoEligibleColumn);
  });

  it('explanation for Active states SharePoint is the source of truth, verbatim', () => {
    expect(reviewDateStatusExplanation({ kind: 'Active', mapping: activeMapping })).toBe(
      "SharePoint is now the source of truth for this library's review dates.",
    );
  });

  it('explanation for Stale states sync stopped and does not claim data loss', () => {
    const text = reviewDateStatusExplanation({ kind: 'Stale', mapping: staleMapping });
    expect(text).toContain('no longer available');
    expect(text).toContain('stopped synchronizing');
  });

  it('explanation for MultipleEligibleColumns states an administrator must explicitly select', () => {
    const eligibility = { status: 'MultipleEligibleColumns' as const, columns: [] };
    expect(reviewDateStatusExplanation({ kind: 'MultipleEligibleColumns', eligibility })).toContain(
      'No column will be used until an administrator explicitly selects one.',
    );
  });

  it('explanation for NotChecked states the review-date column has not been checked yet', () => {
    expect(reviewDateStatusExplanation({ kind: 'NotChecked' })).toBe('Review-date column has not been checked yet.');
  });
});

describe('remediation and overwrite copy — exact wording per the approved plan', () => {
  it('NO_ELIGIBLE_COLUMN_GUIDANCE never implies automatic column creation', () => {
    expect(NO_ELIGIBLE_COLUMN_GUIDANCE).toContain('create a Date and Time column in SharePoint');
    expect(NO_ELIGIBLE_COLUMN_GUIDANCE).not.toMatch(/we (will|can) create/i);
  });

  it('CONFIRM_OVERWRITE_WARNING explicitly states existing manual dates may be replaced', () => {
    expect(CONFIRM_OVERWRITE_WARNING).toContain('Existing manually-entered review dates may be replaced');
  });
});
