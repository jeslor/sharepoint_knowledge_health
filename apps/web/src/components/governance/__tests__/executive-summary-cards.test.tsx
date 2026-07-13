import { render, screen } from '@testing-library/react';
import type { GovernanceSummaryResponse } from '@sph/types';
import { ExecutiveSummaryCards } from '../executive-summary-cards';

function summary(overrides: Partial<GovernanceSummaryResponse> = {}): GovernanceSummaryResponse {
  return {
    openCount: 4,
    inProgressCount: 2,
    resolvedCount: 10,
    criticalCount: 3,
    assignedCount: 5,
    byType: {},
    totalCount: 16,
    averageResolutionTimeHours: 30,
    createdThisMonth: 6,
    resolvedThisMonth: 8,
    completionRate: 63,
    ...overrides,
  };
}

describe('ExecutiveSummaryCards', () => {
  it('renders all 5 executive metrics', () => {
    render(<ExecutiveSummaryCards summary={summary()} />);

    expect(screen.getByText('Open issues')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Resolved this month')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Critical issues')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Governance completion rate')).toBeInTheDocument();
    expect(screen.getByText('63%')).toBeInTheDocument();
  });

  it('formats average resolution time under 24h in hours', () => {
    render(<ExecutiveSummaryCards summary={summary({ averageResolutionTimeHours: 5.25 })} />);
    expect(screen.getByText('5.3h')).toBeInTheDocument();
  });

  it('formats average resolution time at or above 24h in days', () => {
    render(<ExecutiveSummaryCards summary={summary({ averageResolutionTimeHours: 72 })} />);
    expect(screen.getByText('3.0d')).toBeInTheDocument();
  });

  it('shows a placeholder when there is no resolved issue to average yet', () => {
    render(<ExecutiveSummaryCards summary={summary({ averageResolutionTimeHours: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
