import { render, screen } from '@testing-library/react';
import { TriggerScanButton } from '../trigger-scan-button';

const mockTrigger = jest.fn();
let mockTriggering = false;
let mockError: Error | undefined;

jest.mock('@/lib/api/hooks/use-trigger-scan', () => ({
  useTriggerScan: () => ({ trigger: mockTrigger, triggering: mockTriggering, error: mockError }),
}));

describe('TriggerScanButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTriggering = false;
    mockError = undefined;
  });

  it('is disabled while a scan is already in flight (disabled prop)', () => {
    render(<TriggerScanButton disabled onTriggered={jest.fn()} />);

    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
  });

  it('is disabled while the trigger request itself is in flight', () => {
    mockTriggering = true;
    render(<TriggerScanButton disabled={false} onTriggered={jest.fn()} />);

    expect(screen.getByRole('button', { name: /starting scan/i })).toBeDisabled();
  });

  // Root cause regression test (2026-07-25): a plain text swap read as an
  // abrupt change with no sense of ongoing activity — a spinner during the
  // in-flight request makes it read as live feedback, not a static label.
  it('shows a spinner while the trigger request is in flight, and none otherwise', () => {
    mockTriggering = true;
    const { rerender } = render(<TriggerScanButton disabled={false} onTriggered={jest.fn()} />);
    expect(screen.getByRole('button').querySelector('svg')).toBeInTheDocument();

    mockTriggering = false;
    rerender(<TriggerScanButton disabled={false} onTriggered={jest.fn()} />);
    expect(screen.getByRole('button').querySelector('svg')).not.toBeInTheDocument();
  });

  it('is enabled when no scan is active and nothing is in flight', () => {
    render(<TriggerScanButton disabled={false} onTriggered={jest.fn()} />);

    expect(screen.getByRole('button', { name: /start scan/i })).toBeEnabled();
  });

  it('renders the error message when triggering fails', () => {
    mockError = new Error('A scan is already in progress for this Microsoft tenant');
    render(<TriggerScanButton disabled={false} onTriggered={jest.fn()} />);

    expect(screen.getByText('A scan is already in progress for this Microsoft tenant')).toBeInTheDocument();
  });
});
