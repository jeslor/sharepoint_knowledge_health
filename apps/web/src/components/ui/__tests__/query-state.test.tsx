import { render, screen } from '@testing-library/react';
import { EmptyState, ErrorState, LoadingState } from '../query-state';

describe('LoadingState', () => {
  it('exposes the label as an accessible name via role=status, not as visible text', () => {
    render(<LoadingState label="Loading scans…" />);
    expect(screen.getByRole('status', { name: 'Loading scans…' })).toBeInTheDocument();
  });

  it('renders a table-rows skeleton with the requested row count, each with the shimmer sweep', () => {
    render(<LoadingState variant="table-rows" rows={4} label="Loading documents…" />);
    const status = screen.getByRole('status');
    expect(status.children.length).toBe(4);
    expect(status.querySelectorAll('.animate-shimmer').length).toBe(4);
  });

  it('renders a card skeleton matching the Card primitive shell, with the shimmer sweep', () => {
    render(<LoadingState variant="card" label="Loading…" />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('rounded-xl');
    expect(status.className).toContain('shadow-card');
    expect(status.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(0);
  });
});

describe('ErrorState', () => {
  it('renders the error message with an alert role and an icon', () => {
    render(<ErrorState error={new Error('Request timed out')} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Request timed out');
    expect(alert.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to a generic message when the error has none', () => {
    render(<ErrorState error={new Error('')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  });
});

describe('EmptyState', () => {
  it('renders the label with a recognition icon', () => {
    render(<EmptyState label="No documents match the current filters." />);
    expect(screen.getByText('No documents match the current filters.')).toBeInTheDocument();
  });
});
