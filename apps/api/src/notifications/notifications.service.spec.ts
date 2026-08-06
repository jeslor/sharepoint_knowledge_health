import { createTenantContext } from '@sph/database';
import { NotificationsService } from './notifications.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('NotificationsService', () => {
  const service = new NotificationsService();

  const notifications = { findMany: jest.fn(), count: jest.fn(), findFirstById: jest.fn(), markRead: jest.fn(), markAllReadForUser: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ notifications } as never);
    notifications.findMany.mockResolvedValue([]);
    notifications.count.mockResolvedValue(0);
  });

  describe('list', () => {
    it('always scopes to the requesting user, not just the organization', async () => {
      await service.list('org-1', 'user-1', {});

      expect(notifications.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    });

    it('applies the read filter when provided', async () => {
      await service.list('org-1', 'user-1', { read: false });

      expect(notifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', read: false } }),
      );
    });

    it('orders by createdAt descending by default and paginates', async () => {
      await service.list('org-1', 'user-1', {});

      expect(notifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' }, skip: 0, take: 25 }),
      );
    });
  });

  describe('unreadCount', () => {
    it('counts only this user\'s unread notifications', async () => {
      notifications.count.mockResolvedValue(3);

      const result = await service.unreadCount('org-1', 'user-1');

      expect(notifications.count).toHaveBeenCalledWith({ where: { userId: 'user-1', read: false } });
      expect(result).toBe(3);
    });
  });

  describe('markRead', () => {
    it('returns null when the notification does not exist for this organization', async () => {
      notifications.findFirstById.mockResolvedValue(null);

      const result = await service.markRead('org-1', 'user-1', 'notif-missing');

      expect(result).toBeNull();
      expect(notifications.markRead).not.toHaveBeenCalled();
    });

    it('returns null (not the other user\'s data) when the notification belongs to a different user in the same organization', async () => {
      notifications.findFirstById.mockResolvedValue({ id: 'notif-1', userId: 'user-2' });

      const result = await service.markRead('org-1', 'user-1', 'notif-1');

      expect(result).toBeNull();
      expect(notifications.markRead).not.toHaveBeenCalled();
    });

    it('marks read when the notification belongs to the requesting user', async () => {
      notifications.findFirstById.mockResolvedValue({ id: 'notif-1', userId: 'user-1' });
      notifications.markRead.mockResolvedValue({
        id: 'notif-1',
        type: 'IssueAssigned',
        message: 'You were assigned a governance issue.',
        governanceIssueId: 'issue-1',
        documentId: 'doc-1',
        read: true,
        createdAt: new Date('2026-08-05T00:00:00.000Z'),
      });

      const result = await service.markRead('org-1', 'user-1', 'notif-1');

      expect(notifications.markRead).toHaveBeenCalledWith('notif-1');
      expect(result).toEqual(
        expect.objectContaining({ id: 'notif-1', read: true, createdAt: '2026-08-05T00:00:00.000Z' }),
      );
    });
  });

  describe('markAllRead', () => {
    it('delegates to the repository, scoped to the requesting user', async () => {
      notifications.markAllReadForUser.mockResolvedValue(5);

      const result = await service.markAllRead('org-1', 'user-1');

      expect(notifications.markAllReadForUser).toHaveBeenCalledWith('user-1');
      expect(result).toBe(5);
    });
  });

  describe('tenant isolation', () => {
    it('only reads this organization\'s tenant context', async () => {
      await service.list('org-42', 'user-1', {});
      expect(mockedCreateContext).toHaveBeenCalledWith('org-42');
    });
  });
});
