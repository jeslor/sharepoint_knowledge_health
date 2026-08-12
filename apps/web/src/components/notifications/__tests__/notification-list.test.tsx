import { render, screen, fireEvent } from '@testing-library/react';
import type { NotificationResponse } from '@sph/types';
import { NotificationList } from '../notification-list';

function notification(overrides: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 'notification-1',
    type: 'IssueAssigned',
    message: 'You were assigned a governance issue (Freshness).',
    governanceIssueId: 'issue-1',
    documentId: 'doc-1',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationList', () => {
  it('shows an empty state when there are no notifications', () => {
    render(<NotificationList notifications={[]} onOpen={jest.fn()} />);
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('links to the governance issue when governanceIssueId is set', () => {
    render(<NotificationList notifications={[notification({ governanceIssueId: 'issue-42' })]} onOpen={jest.fn()} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/governance/issues/issue-42');
  });

  it('falls back to the document link when only documentId is set (OwnerAssigned notifications)', () => {
    render(
      <NotificationList
        notifications={[notification({ type: 'OwnerAssigned', governanceIssueId: null, documentId: 'doc-42' })]}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/documents/doc-42');
  });

  it('renders a non-interactive row (no link) when neither id is set', () => {
    render(<NotificationList notifications={[notification({ governanceIssueId: null, documentId: null })]} onOpen={jest.fn()} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(notification().message)).toBeInTheDocument();
  });

  it('calls onOpen with the notification id when an unread notification is clicked', () => {
    const onOpen = jest.fn();
    render(<NotificationList notifications={[notification({ id: 'notification-7', read: false })]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('link'));

    expect(onOpen).toHaveBeenCalledWith('notification-7');
  });

  it('still calls onOpen when clicking an already-read notification (idempotent on the server side)', () => {
    const onOpen = jest.fn();
    render(<NotificationList notifications={[notification({ id: 'notification-7', read: true })]} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('link'));

    expect(onOpen).toHaveBeenCalledWith('notification-7');
  });

  it('reserves the same layout space for the unread dot on read and unread rows (fixes read/unread message text misalignment)', () => {
    const { container: unreadContainer } = render(
      <NotificationList notifications={[notification({ id: 'unread-1', read: false })]} onOpen={jest.fn()} />,
    );
    const { container: readContainer } = render(
      <NotificationList notifications={[notification({ id: 'read-1', read: true })]} onOpen={jest.fn()} />,
    );

    const unreadDot = unreadContainer.querySelector('[aria-hidden="true"]');
    const readDot = readContainer.querySelector('[aria-hidden="true"]');

    // Both rows render the same dot element (same layout slot reserved) —
    // only its visibility differs, never its presence in the DOM.
    expect(unreadDot).not.toBeNull();
    expect(readDot).not.toBeNull();
    expect(unreadDot).not.toHaveClass('invisible');
    expect(readDot).toHaveClass('invisible');
  });

  it('renders multiple notifications, most recent first as provided by the caller (no re-sorting)', () => {
    render(
      <NotificationList
        notifications={[notification({ id: 'a', message: 'First' }), notification({ id: 'b', message: 'Second' })]}
        onOpen={jest.fn()}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveTextContent('First');
    expect(links[1]).toHaveTextContent('Second');
  });
});
