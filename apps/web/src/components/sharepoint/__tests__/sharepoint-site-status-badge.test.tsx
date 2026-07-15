import { render, screen } from '@testing-library/react';
import { SharePointSiteStatusBadge } from '../sharepoint-site-status-badge';

describe('SharePointSiteStatusBadge', () => {
  it.each([
    ['Discovered', 'Pending approval'],
    ['Approved', 'Approved'],
    ['Removed', 'Revoked'],
  ])('renders %s as "%s"', (status, label) => {
    render(<SharePointSiteStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
