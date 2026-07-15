import { render, screen } from '@testing-library/react';
import { UserStatusBadge } from '../user-status-badge';

describe('UserStatusBadge', () => {
  it.each([
    ['Active', 'Active'],
    ['PendingApproval', 'Pending approval'],
    ['Deactivated', 'Deactivated'],
  ])('renders %s as "%s"', (status, label) => {
    render(<UserStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
