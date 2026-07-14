import { render, screen } from '@testing-library/react';
import type { DocumentScoreHistoryPoint } from '@sph/types';
import { DocumentScoreHistory } from '../document-score-history';

describe('DocumentScoreHistory', () => {
  it('renders an empty state when the document has never been scored', () => {
    render(<DocumentScoreHistory points={[]} />);

    expect(screen.getByText('No scan history yet.')).toBeInTheDocument();
  });

  it('renders every past score, most recent first, without recalculating anything', () => {
    const points: DocumentScoreHistoryPoint[] = [
      { calculatedAt: '2026-06-01T00:00:00.000Z', score: 60, band: 'Fair' },
      { calculatedAt: '2026-07-01T00:00:00.000Z', score: 85, band: 'Good' },
    ];
    render(<DocumentScoreHistory points={points} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('85/100');
    expect(items[0]).toHaveTextContent('Good');
    expect(items[1]).toHaveTextContent('60/100');
    expect(items[1]).toHaveTextContent('Fair');
  });

  it('shows the chart once there are 2+ scores', () => {
    const points: DocumentScoreHistoryPoint[] = [
      { calculatedAt: '2026-06-01T00:00:00.000Z', score: 60, band: 'Fair' },
      { calculatedAt: '2026-07-01T00:00:00.000Z', score: 85, band: 'Good' },
    ];
    render(<DocumentScoreHistory points={points} />);

    expect(screen.getByRole('img', { name: 'Score over time' })).toBeInTheDocument();
  });
});
