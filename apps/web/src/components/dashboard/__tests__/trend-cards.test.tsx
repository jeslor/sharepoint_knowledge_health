import { render, screen } from '@testing-library/react';
import type { HealthTrendResponse } from '@sph/types';
import { TrendCards } from '../trend-cards';

describe('TrendCards', () => {
  it('shows "Not enough data yet" for every comparison-dependent card and a zero scan count when there is no history', () => {
    const trend: HealthTrendResponse = { days: 30, points: [] };
    render(<TrendCards trend={trend} />);

    expect(screen.getAllByText('Not enough data yet').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText('Total completed scans').parentElement).toHaveTextContent('0');
  });

  it('renders current, previous, highest, lowest, average score and total completed scans from HealthSnapshot history', () => {
    const trend: HealthTrendResponse = {
      days: 30,
      points: [
        { capturedAt: '2026-06-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 5, warningIssuesCount: 8, totalDocumentsScanned: 90 },
        { capturedAt: '2026-07-01T00:00:00.000Z', averageHealthScore: 82, criticalIssuesCount: 2, warningIssuesCount: 10, totalDocumentsScanned: 100 },
      ],
    };
    render(<TrendCards trend={trend} />);

    expect(screen.getByText('Current score').parentElement).toHaveTextContent('82/100');
    expect(screen.getByText('Previous score').parentElement).toHaveTextContent('70/100');
    expect(screen.getByText('Highest score').parentElement).toHaveTextContent('82/100');
    expect(screen.getByText('Lowest score').parentElement).toHaveTextContent('70/100');
    expect(screen.getByText('Average score').parentElement).toHaveTextContent('76/100');
    expect(screen.getByText('Total completed scans').parentElement).toHaveTextContent('2');
  });

  it('shows an improving (green, up arrow) indicator when the score rises vs the immediately preceding scan', () => {
    const trend: HealthTrendResponse = {
      days: 30,
      points: [
        { capturedAt: '2026-06-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 5, warningIssuesCount: 8, totalDocumentsScanned: 90 },
        { capturedAt: '2026-07-01T00:00:00.000Z', averageHealthScore: 82, criticalIssuesCount: 2, warningIssuesCount: 10, totalDocumentsScanned: 100 },
      ],
    };
    render(<TrendCards trend={trend} />);

    const indicator = screen.getByText(/▲ \+12 vs previous scan/);
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('text-emerald-600');
  });

  it('shows a declining (red, down arrow) indicator when critical issues increase vs the previous scan', () => {
    const trend: HealthTrendResponse = {
      days: 30,
      points: [
        { capturedAt: '2026-06-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 2, warningIssuesCount: 8, totalDocumentsScanned: 90 },
        { capturedAt: '2026-07-01T00:00:00.000Z', averageHealthScore: 82, criticalIssuesCount: 5, warningIssuesCount: 10, totalDocumentsScanned: 100 },
      ],
    };
    render(<TrendCards trend={trend} />);

    const indicator = screen.getByText(/▲ \+3 vs previous scan/);
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('text-red-600');
  });

  it('shows an improving (green, down arrow) indicator when warning issues decrease vs the previous scan', () => {
    const trend: HealthTrendResponse = {
      days: 30,
      points: [
        { capturedAt: '2026-06-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 5, warningIssuesCount: 10, totalDocumentsScanned: 90 },
        { capturedAt: '2026-07-01T00:00:00.000Z', averageHealthScore: 82, criticalIssuesCount: 5, warningIssuesCount: 4, totalDocumentsScanned: 100 },
      ],
    };
    render(<TrendCards trend={trend} />);

    const indicator = screen.getByText(/▼ -6 vs previous scan/);
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveClass('text-emerald-600');
  });

  it('shows a stable indicator when a value is unchanged vs the previous scan', () => {
    const trend: HealthTrendResponse = {
      days: 30,
      points: [
        { capturedAt: '2026-06-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 5, warningIssuesCount: 8, totalDocumentsScanned: 90 },
        { capturedAt: '2026-07-01T00:00:00.000Z', averageHealthScore: 70, criticalIssuesCount: 5, warningIssuesCount: 8, totalDocumentsScanned: 90 },
      ],
    };
    render(<TrendCards trend={trend} />);

    expect(screen.getAllByText(/— stable/).length).toBeGreaterThan(0);
  });
});
