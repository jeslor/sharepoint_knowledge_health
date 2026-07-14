import { prisma } from './client';
import { checkDatabaseConnection } from './health-check';

jest.mock('./client', () => ({ prisma: { $queryRaw: jest.fn() } }));

const mockedQueryRaw = prisma.$queryRaw as jest.MockedFunction<typeof prisma.$queryRaw>;

describe('checkDatabaseConnection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when the database responds', async () => {
    mockedQueryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const result = await checkDatabaseConnection();
    expect(result).toBe(true);
  });

  it('returns false, never throws, when the database is unreachable', async () => {
    mockedQueryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(checkDatabaseConnection()).resolves.toBe(false);
  });
});
