import { render, screen } from '@testing-library/react';
import { PageHeader } from '../page-header';

describe('PageHeader', () => {
  it('renders the title as an h1', () => {
    render(<PageHeader title="Documents" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Documents' })).toBeInTheDocument();
  });

  it('renders an optional description', () => {
    render(<PageHeader title="Documents" description="Monitor and improve document health." />);
    expect(screen.getByText('Monitor and improve document health.')).toBeInTheDocument();
  });

  it('renders an optional primary action', () => {
    render(<PageHeader title="Documents" action={<button type="button">Export</button>} />);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });
});
