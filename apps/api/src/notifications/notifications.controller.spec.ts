import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { User } from '@sph/database';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

function user(id: string): User {
  return { id } as User;
}

describe('NotificationsController', () => {
  const service = { list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn() };
  const controller = new NotificationsController(service as unknown as NotificationsService);

  beforeEach(() => jest.clearAllMocks());

  describe('list', () => {
    it('passes the current user\'s id, not anything from the request body/query', async () => {
      service.list.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.list('org-1', user('user-1'), {});

      expect(service.list).toHaveBeenCalledWith('org-1', 'user-1', expect.objectContaining({}));
    });

    it('parses the read filter', async () => {
      service.list.mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });

      await controller.list('org-1', user('user-1'), { read: 'false' });

      expect(service.list).toHaveBeenCalledWith('org-1', 'user-1', expect.objectContaining({ read: false }));
    });

    it.each([
      ['page', { page: '0' }],
      ['pageSize', { pageSize: '101' }],
      ['sortDir', { sortDir: 'bogus' }],
      ['read', { read: 'maybe' }],
    ])('rejects an invalid %s value with 400', async (_label, badQuery) => {
      await expect(controller.list('org-1', user('user-1'), badQuery)).rejects.toThrow(BadRequestException);
      expect(service.list).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('returns the count wrapped in an object', async () => {
      service.unreadCount.mockResolvedValue(7);

      const result = await controller.unreadCount('org-1', user('user-1'));

      expect(service.unreadCount).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result).toEqual({ count: 7 });
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException when the service returns null (not found, or not this user\'s)', async () => {
      service.markRead.mockResolvedValue(null);

      await expect(controller.markRead('org-1', 'notif-1', user('user-1'))).rejects.toThrow(NotFoundException);
    });

    it('returns the updated notification on success', async () => {
      const updated = { id: 'notif-1', read: true };
      service.markRead.mockResolvedValue(updated);

      const result = await controller.markRead('org-1', 'notif-1', user('user-1'));

      expect(service.markRead).toHaveBeenCalledWith('org-1', 'user-1', 'notif-1');
      expect(result).toBe(updated);
    });
  });

  describe('markAllRead', () => {
    it('returns the updated count', async () => {
      service.markAllRead.mockResolvedValue(4);

      const result = await controller.markAllRead('org-1', user('user-1'));

      expect(service.markAllRead).toHaveBeenCalledWith('org-1', 'user-1');
      expect(result).toEqual({ updatedCount: 4 });
    });
  });
});
