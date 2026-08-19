import { render, screen } from '@testing-library/react';
import type { ReviewDateHealthState } from '@sph/types';
import { ReviewDateHealthBadge } from '../review-date-health-badge';

describe('ReviewDateHealthBadge', () => {
  it.each<[ReviewDateHealthState, string]>([
    ['Missing', 'Missing'],
    ['Overdue', 'Overdue'],
    ['DueSoon', 'Due Soon'],
    ['Healthy', 'Healthy'],
  ])('renders a distinct, human-readable label for %s — never the raw enum value', (state, label) => {
    render(<ReviewDateHealthBadge state={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    if (state !== label) {
      expect(screen.queryByText(state)).not.toBeInTheDocument();
    }
  });
});
