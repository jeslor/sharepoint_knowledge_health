import { render, screen } from '@testing-library/react';
import HelpPage from '../page';

describe('HelpPage', () => {
  it('renders the hero heading and the guide entry point', () => {
    render(<HelpPage />);

    expect(screen.getByRole('heading', { name: 'Help & Guide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start the guide/i })).toHaveAttribute('href', '/dashboard/help/document-health');
  });

  it('renders every topic group with links to real in-app routes', () => {
    render(<HelpPage />);

    expect(screen.getByRole('heading', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Understanding the Score' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Improving Your Content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Administration' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'View and fix unhealthy documents' })).toHaveAttribute('href', '/dashboard/documents');
    expect(screen.getByRole('link', { name: 'Scanning and scheduling' })).toHaveAttribute('href', '/dashboard/scans');
    expect(screen.getByRole('link', { name: 'Refresh Microsoft 365 permissions' })).toHaveAttribute('href', '/dashboard/settings');
  });
});
