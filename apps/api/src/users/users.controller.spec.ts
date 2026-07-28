import { UsersController } from './users.controller';
import type { UsersService } from './users.service';

describe('UsersController', () => {
  const service = { listUsers: jest.fn(), approveUser: jest.fn(), rejectUser: jest.fn() };
  const controller = new UsersController(service as unknown as UsersService);

  beforeEach(() => jest.clearAllMocks());

  it('listUsers delegates organizationId from the route', async () => {
    service.listUsers.mockResolvedValue([]);

    await controller.listUsers('org-1');

    expect(service.listUsers).toHaveBeenCalledWith('org-1');
  });

  it('approveUser delegates organizationId, userId, and the current user id as actor — never trusts a client-supplied actor', async () => {
    service.approveUser.mockResolvedValue({ id: 'user-1', status: 'Active' });

    const result = await controller.approveUser('org-1', 'user-1', { id: 'admin-1' } as never);

    expect(service.approveUser).toHaveBeenCalledWith('org-1', 'user-1', 'admin-1');
    expect(result).toEqual({ id: 'user-1', status: 'Active' });
  });

  it('rejectUser delegates organizationId, userId, and the current user id as actor', async () => {
    service.rejectUser.mockResolvedValue({ id: 'user-1', status: 'Deactivated' });

    const result = await controller.rejectUser('org-1', 'user-1', { id: 'admin-1' } as never);

    expect(service.rejectUser).toHaveBeenCalledWith('org-1', 'user-1', 'admin-1');
    expect(result).toEqual({ id: 'user-1', status: 'Deactivated' });
  });
});
