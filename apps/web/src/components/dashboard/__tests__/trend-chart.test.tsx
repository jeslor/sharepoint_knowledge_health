import { render, screen } from '@testing-library/react';
import { TrendChart } from '../trend-chart';

describe('TrendChart', () => {
  it('shows the empty-state message instead of a chart when fewer than 2 points are given', () => {
    render(<TrendChart title="Average health score" points={[{ label: 'Jul 1', value: 80 }]} />);

    expect(screen.getByText('Not enough data yet.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a custom empty-state label when provided', () => {
    render(<TrendChart title="Average health score" points={[]} emptyLabel="Not enough scan history yet." />);

    expect(screen.getByText('Not enough scan history yet.')).toBeInTheDocument();
  });

  it('renders an accessible svg with first/last labels when 2+ points are given', () => {
    render(
      <TrendChart
        title="Average health score"
        points={[
          { label: 'Jun 1', value: 70 },
          { label: 'Jul 1', value: 82 },
        ]}
      />,
    );

    expect(screen.getByRole('img', { name: 'Average health score' })).toBeInTheDocument();
    expect(screen.getByText('Jun 1')).toBeInTheDocument();
    expect(screen.getByText('Jul 1')).toBeInTheDocument();
  });
});
