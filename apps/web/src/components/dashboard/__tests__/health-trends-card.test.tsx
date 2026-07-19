import { render, screen } from '@testing-library/react';
import type { HealthTrendResponse } from '@sph/types';
import { HealthTrendsCard } from '../health-trends-card';

function trend(overrides: Partial<HealthTrendResponse> = {}): HealthTrendResponse {
  return {
    days: 30,
    points: [
      { capturedAt: '2026-06-19T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 20, warningIssuesCount: 10, totalDocumentsScanned: 1000 },
      { capturedAt: '2026-07-19T00:00:00.000Z', averageHealthScore: 78, criticalIssuesCount: 12, warningIssuesCount: 34, totalDocumentsScanned: 1204 },
    ],
    ...overrides,
  };
}

describe('HealthTrendsCard', () => {
  it('renders the section heading and the trend chart', () => {
    render(<HealthTrendsCard trend={trend()} />);
    expect(screen.getByRole('heading', { name: 'Health trends' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('shows an improving delta vs the previous scan', () => {
    render(<HealthTrendsCard trend={trend()} />);
    expect(screen.getByText('▲ +8 vs previous scan')).toBeInTheDocument();
  });

  it('shows a declining delta with the correct color', () => {
    render(
      <HealthTrendsCard
        trend={trend({
          points: [
            { capturedAt: '2026-06-19T00:00:00.000Z', averageHealthScore: 80, criticalIssuesCount: 5, warningIssuesCount: 5, totalDocumentsScanned: 900 },
            { capturedAt: '2026-07-19T00:00:00.000Z', averageHealthScore: 72, criticalIssuesCount: 15, warningIssuesCount: 20, totalDocumentsScanned: 950 },
          ],
        })}
      />,
    );
    const delta = screen.getByText('▼ -8 vs previous scan');
    expect(delta.className).toContain('text-red-600');
  });

  it('omits the delta line when there are fewer than 2 scored points', () => {
    render(<HealthTrendsCard trend={trend({ points: [] })} />);
    expect(screen.queryByText(/vs previous scan/)).not.toBeInTheDocument();
  });
});
