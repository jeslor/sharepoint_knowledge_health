import { render, screen, fireEvent } from '@testing-library/react';
import { Toast } from '../toast';

describe('Toast', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the message', () => {
    render(<Toast message="Assignment updated" onDismiss={jest.fn()} durationMs={0} />);
    expect(screen.getByText('Assignment updated')).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = jest.fn();
    render(<Toast message="Assignment updated" onDismiss={onDismiss} durationMs={0} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('auto-dismisses after durationMs', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="Assignment updated" onDismiss={onDismiss} durationMs={4000} />);

    expect(onDismiss).not.toHaveBeenCalled();
    jest.advanceTimersByTime(4000);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not auto-dismiss when durationMs is 0', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="Assignment updated" onDismiss={onDismiss} durationMs={0} />);

    jest.advanceTimersByTime(60_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  describe('action link (P0-7)', () => {
    it('renders no link when no action is supplied', () => {
      render(<Toast message="Assignment updated" onDismiss={jest.fn()} durationMs={0} />);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('renders the action as a link to the given href', () => {
      render(
        <Toast
          message="Remediation started for 2 documents."
          onDismiss={jest.fn()}
          durationMs={0}
          action={{ label: 'View progress', href: '/dashboard/documents/remediation-jobs/job-1' }}
        />,
      );

      const link = screen.getByRole('link', { name: 'View progress' });
      expect(link).toHaveAttribute('href', '/dashboard/documents/remediation-jobs/job-1');
    });
  });
});
