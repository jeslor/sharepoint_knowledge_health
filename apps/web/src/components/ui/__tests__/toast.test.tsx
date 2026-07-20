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
});
