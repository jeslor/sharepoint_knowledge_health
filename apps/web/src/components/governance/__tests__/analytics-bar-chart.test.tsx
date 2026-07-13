import { render, screen } from '@testing-library/react';
import { AnalyticsBarChart } from '../analytics-bar-chart';

describe('AnalyticsBarChart', () => {
  it('shows a "no data" message when every bucket is zero', () => {
    render(<AnalyticsBarChart title="Issues by type" buckets={[{ label: 'Freshness', count: 0 }]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });

  it('shows a "no data" message when there are no buckets at all', () => {
    render(<AnalyticsBarChart title="Issues by type" buckets={[]} />);
    expect(screen.getByText('No data yet.')).toBeInTheDocument();
  });

  it('renders each bucket label and count', () => {
    render(
      <AnalyticsBarChart
        title="Issues by type"
        buckets={[
          { label: 'Freshness', count: 5 },
          { label: 'Ownership', count: 2 },
        ]}
      />,
    );

    expect(screen.getByText('Issues by type')).toBeInTheDocument();
    expect(screen.getByText('Freshness')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Ownership')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
