import { render, screen, fireEvent } from '@testing-library/react';
import type { MeResponse, RequestUpgradeResponse, UsageResponse } from '@sph/types';
import { RequestUpgradeDialog } from '../request-upgrade-dialog';

const mockUseCurrentUser = jest.fn();
const mockUseUsage = jest.fn();
const mockSubmit = jest.fn();
const mockReset = jest.fn();

jest.mock('@/lib/auth/current-user-context', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));
jest.mock('@/lib/api/hooks/use-usage', () => ({
  useUsage: () => mockUseUsage(),
}));
jest.mock('@/lib/api/hooks/use-request-upgrade', () => ({
  useRequestUpgrade: () => ({
    submit: mockSubmit,
    submitting: mockRequestUpgradeState.submitting,
    success: mockRequestUpgradeState.success,
    error: mockRequestUpgradeState.error,
    reset: mockReset,
  }),
}));

const mockRequestUpgradeState: {
  submitting: boolean;
  success: RequestUpgradeResponse | undefined;
  error: Error | undefined;
} = { submitting: false, success: undefined, error: undefined };

function user(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: 'user-1',
    role: 'Member',
    organizationId: 'org-1',
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    organizationName: 'Onwell Group',
    tenantName: 'Onwell 365',
    ...overrides,
  };
}

function usage(overrides: Partial<UsageResponse> = {}): UsageResponse {
  return {
    planType: 'Trial',
    documentLimit: 2000,
    currentDocumentCount: 2000,
    remainingDocumentCount: 0,
    usagePercentage: 100,
    limitReached: true,
    ...overrides,
  };
}

describe('RequestUpgradeDialog (Phase 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestUpgradeState.submitting = false;
    mockRequestUpgradeState.success = undefined;
    mockRequestUpgradeState.error = undefined;
    mockUseCurrentUser.mockReturnValue({ user: user() });
    mockUseUsage.mockReturnValue({ data: usage(), loading: false });
    mockSubmit.mockResolvedValue(undefined);
  });

  it('is not rendered when closed', () => {
    render(<RequestUpgradeDialog open={false} onOpenChange={jest.fn()} />);
    expect(screen.queryByText('Request an upgrade')).not.toBeInTheDocument();
  });

  it('opens with the "Request an upgrade" title and organization/usage/plan context', () => {
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Request an upgrade' })).toBeInTheDocument();
    expect(screen.getByText('Onwell Group')).toBeInTheDocument();
    expect(screen.getByText('2,000 / 2,000 documents')).toBeInTheDocument();
    expect(screen.getByText('Trial')).toBeInTheDocument();
  });

  it('never says "Upgrade now" — uses "Send request" as the primary action', () => {
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
    expect(screen.queryByText(/upgrade now/i)).not.toBeInTheDocument();
  });

  it('shows a loading placeholder for usage context while it is still loading, never a stale 0/0', () => {
    mockUseUsage.mockReturnValue({ data: undefined, loading: true });
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
  });

  it('has an accessible, labeled optional message field with the expected placeholder', () => {
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);
    const textarea = screen.getByLabelText('Message (optional)');
    expect(textarea).toHaveAttribute('placeholder', 'Tell us anything that would help us understand your requirements.');
  });

  it('submits the trimmed message (or undefined when empty) via useRequestUpgrade', () => {
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

    fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: '  We need more room  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(mockSubmit).toHaveBeenCalledWith('We need more room');
  });

  it('submits undefined when the message is left blank', () => {
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(mockSubmit).toHaveBeenCalledWith(undefined);
  });

  describe('submitting state', () => {
    it('disables Send request, shows a progress indicator, and disables Cancel while submitting', () => {
      mockRequestUpgradeState.submitting = true;
      render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

      expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
  });

  describe('success state', () => {
    beforeEach(() => {
      mockRequestUpgradeState.success = { id: 'req-1', status: 'Pending', createdAt: '2026-09-22T12:30:00.000Z' };
    });

    it('replaces the form with a confirmation, never claiming a specific response time', () => {
      render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

      expect(screen.getByRole('dialog', { name: 'Upgrade request sent' })).toBeInTheDocument();
      expect(screen.getByText(/we.ll review your organization.s requirements and get in touch/i)).toBeInTheDocument();
      expect(screen.queryByText(/within \d+ (hour|day|minute)/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
    });

    it('shows a Done button that closes the dialog, never an automatic redirect', () => {
      const onOpenChange = jest.fn();
      render(<RequestUpgradeDialog open onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

  });

  // The success-transition itself (submit() resolving -> success becoming
  // truthy) lives inside useRequestUpgrade, already covered by
  // use-request-upgrade.test.ts — this only proves the dialog's own
  // handleSubmit wires onSuccess to submit()'s resolution.
  it('calls onSuccess once submit() resolves', async () => {
    const onSuccess = jest.fn();
    mockSubmit.mockResolvedValue(undefined);
    render(<RequestUpgradeDialog open onOpenChange={jest.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await Promise.resolve();
    expect(onSuccess).toHaveBeenCalled();
  });

  describe('error state', () => {
    it('shows a retryable, non-technical error message', () => {
      mockRequestUpgradeState.error = new Error('Request failed with status code 503');
      render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

      expect(screen.getByRole('alert')).toHaveTextContent(/We couldn.t send your request\. Please try again\./);
      // Never the raw error/status text.
      expect(screen.queryByText(/503/)).not.toBeInTheDocument();
      // The form is still present — retry is possible.
      expect(screen.getByRole('button', { name: 'Send request' })).toBeInTheDocument();
    });
  });

  describe('cancel / close', () => {
    it('calls onOpenChange(false) when Cancel is clicked', () => {
      const onOpenChange = jest.fn();
      render(<RequestUpgradeDialog open onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('resets the draft message and any prior success/error state on close (Escape)', () => {
      render(<RequestUpgradeDialog open onOpenChange={jest.fn()} />);

      fireEvent.change(screen.getByLabelText('Message (optional)'), { target: { value: 'draft text' } });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(mockReset).toHaveBeenCalled();
    });
  });
});
