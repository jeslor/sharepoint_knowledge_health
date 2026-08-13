import { render, screen } from '@testing-library/react';
import { ReviewDateStatusBadge } from '../review-date-status-badge';
import type { ReviewDateLibraryStatus } from '../review-date-status';

describe('ReviewDateStatusBadge', () => {
  it('renders a distinct, human-readable label for each status kind — never the raw enum value', () => {
    const cases: ReviewDateLibraryStatus[] = [
      { kind: 'NotChecked' },
      { kind: 'NoEligibleColumn' },
      {
        kind: 'SingleEligibleColumn',
        eligibility: { status: 'SingleEligibleColumn', column: { id: 'col-1', name: 'ReviewDate', displayName: 'Review Date', confidence: 'high' } },
      },
      { kind: 'MultipleEligibleColumns', eligibility: { status: 'MultipleEligibleColumns', columns: [] } },
      {
        kind: 'Active',
        mapping: {
          id: 'm-1',
          siteId: 's-1',
          graphListId: 'l-1',
          columnDefinitionId: 'c-1',
          columnDisplayName: 'Review Date',
          status: 'Active',
          confirmedByUserId: 'u-1',
          confirmedByDisplayName: 'Alice',
          confirmedAt: '2026-08-12T00:00:00.000Z',
        },
      },
      {
        kind: 'Stale',
        mapping: {
          id: 'm-1',
          siteId: 's-1',
          graphListId: 'l-1',
          columnDefinitionId: 'c-1',
          columnDisplayName: 'Review Date',
          status: 'Stale',
          confirmedByUserId: 'u-1',
          confirmedByDisplayName: 'Alice',
          confirmedAt: '2026-08-12T00:00:00.000Z',
        },
      },
    ];

    for (const status of cases) {
      const { unmount } = render(<ReviewDateStatusBadge status={status} />);
      expect(screen.queryByText(status.kind)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('renders "SharePoint review dates enabled" for an Active mapping, verbatim', () => {
    render(
      <ReviewDateStatusBadge
        status={{
          kind: 'Active',
          mapping: {
            id: 'm-1',
            siteId: 's-1',
            graphListId: 'l-1',
            columnDefinitionId: 'c-1',
            columnDisplayName: 'Review Date',
            status: 'Active',
            confirmedByUserId: 'u-1',
            confirmedByDisplayName: 'Alice',
            confirmedAt: '2026-08-12T00:00:00.000Z',
          },
        }}
      />,
    );

    expect(screen.getByText('SharePoint review dates enabled')).toBeInTheDocument();
  });

  it('renders "Not checked" for the NotChecked state, distinct from "No SharePoint column found"', () => {
    render(<ReviewDateStatusBadge status={{ kind: 'NotChecked' }} />);
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });
});
