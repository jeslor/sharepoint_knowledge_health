import { render, screen } from '@testing-library/react';
import { Breadcrumbs } from '../breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders intermediate crumbs as links and the final crumb as plain text', () => {
    render(
      <Breadcrumbs
        crumbs={[
          { label: 'Governance', href: '/dashboard/governance' },
          { label: 'Issue #1' },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Governance' })).toHaveAttribute('href', '/dashboard/governance');
    expect(screen.getByText('Issue #1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue #1' })).not.toBeInTheDocument();
  });
});
