import { ConflictException, NotFoundException } from '@nestjs/common';
import { createTenantContext } from '@sph/database';
import { UsersService } from './users.service';

jest.mock('@sph/database');

const mockedCreateContext = createTenantContext as jest.MockedFunction<typeof createTenantContext>;

describe('UsersService', () => {
  const service = new UsersService();
  const users = { findMany: jest.fn(), findFirstById: jest.fn(), updateById: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreateContext.mockReturnValue({ users } as never);
  });

  describe('listUsers', () => {
    it('returns every user in the organization as a plain response shape', async () => {
      users.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'a@example.com',
          displayName: 'Alice',
          role: 'Admin',
          status: 'Active',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastLoginAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      ]);

      const result = await service.listUsers('org-1');

      expect(result).toEqual([
        {
          id: 'user-1',
          email: 'a@example.com',
          displayName: 'Alice',
          role: 'Admin',
          status: 'Active',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastLoginAt: '2026-02-01T00:00:00.000Z',
        },
      ]);
    });

    it('renders a null lastLoginAt as null, not a crash', async () => {
      users.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'a@example.com',
          displayName: 'Alice',
          role: 'Member',
          status: 'PendingApproval',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          lastLoginAt: null,
        },
      ]);

      const [result] = await service.listUsers('org-1');

      expect(result?.lastLoginAt).toBeNull();
    });
  });

  describe('approveUser', () => {
    it('sets status Active for a pending user', async () => {
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'PendingApproval' });
      users.updateById.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        displayName: 'Alice',
        role: 'Member',
        status: 'Active',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
      });

      const result = await service.approveUser('org-1', 'user-1');

      expect(users.updateById).toHaveBeenCalledWith('user-1', { status: 'Active' });
      expect(result.status).toBe('Active');
    });

    it('throws NotFoundException when the user does not exist in this organization', async () => {
      users.findFirstById.mockResolvedValue(null);

      await expect(service.approveUser('org-1', 'user-missing')).rejects.toThrow(NotFoundException);
      expect(users.updateById).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the user is not PendingApproval', async () => {
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Active' });

      await expect(service.approveUser('org-1', 'user-1')).rejects.toThrow(ConflictException);
      expect(users.updateById).not.toHaveBeenCalled();
    });
  });

  describe('rejectUser', () => {
    it('sets status Deactivated for a pending user', async () => {
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'PendingApproval' });
      users.updateById.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        displayName: 'Alice',
        role: 'Member',
        status: 'Deactivated',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
      });

      const result = await service.rejectUser('org-1', 'user-1');

      expect(users.updateById).toHaveBeenCalledWith('user-1', { status: 'Deactivated' });
      expect(result.status).toBe('Deactivated');
    });

    it('throws ConflictException when the user is already Deactivated', async () => {
      users.findFirstById.mockResolvedValue({ id: 'user-1', status: 'Deactivated' });

      await expect(service.rejectUser('org-1', 'user-1')).rejects.toThrow(ConflictException);
    });
  });
});
