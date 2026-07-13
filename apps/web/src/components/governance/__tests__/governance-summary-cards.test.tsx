import { render, screen } from '@testing-library/react';
import type { GovernanceSummaryResponse } from '@sph/types';
import { GovernanceSummaryCards } from '../governance-summary-cards';

describe('GovernanceSummaryCards', () => {
  it('renders all 5 required governance summary stats', () => {
    const summary: GovernanceSummaryResponse = {
      openCount: 4,
      inProgressCount: 2,
      resolvedCount: 10,
      criticalCount: 3,
      assignedCount: 5,
      byType: {},
    };
    render(<GovernanceSummaryCards summary={summary} />);

    expect(screen.getByText('Open issues')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Critical issues')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Assigned issues')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
