import { render, screen } from '@testing-library/react';
import { GovernanceStatusBadge } from '../governance-status-badge';

describe('GovernanceStatusBadge', () => {
  it.each([
    ['Open', 'Open'],
    ['InProgress', 'In progress'],
    ['Resolved', 'Resolved'],
  ])('renders %s as "%s"', (status, label) => {
    render(<GovernanceStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
