import { Prisma } from '@prisma/client';
import type { PrismaClient, Notification } from '@prisma/client';

export type NotificationCreateData = Omit<Prisma.NotificationUncheckedCreateInput, 'organizationId'>;
export type NotificationUpsertByDedupeKeyData = Omit<Prisma.NotificationUncheckedCreateInput, 'organizationId' | 'dedupeKey'> & {
  dedupeKey: string;
};

// No deleteById — ADR-0021 deliberately defers a retention/pruning policy
// (matching AuditLog's identical, already-accepted "grows unboundedly for
// now" posture, ADR-0019). updateById exists only to flip `read`; there is
// no update data type beyond that single field, kept explicit rather than
// reusing Prisma's full update-input shape.
export class NotificationRepository {
  constructor(
    private readonly organizationId: string,
    private readonly prisma: PrismaClient,
  ) {}

  async findMany<T extends Omit<Prisma.NotificationFindManyArgs, 'where'>>(
    args?: T & { where?: Prisma.NotificationWhereInput },
  ): Promise<Notification[]> {
    const { where, ...rest } = args ?? {};
    return this.prisma.notification.findMany({
      ...rest,
      where: { ...where, organizationId: this.organizationId },
    });
  }

  async findFirstById(id: string): Promise<Notification | null> {
    return this.prisma.notification.findFirst({ where: { id, organizationId: this.organizationId } });
  }

  async count(args?: { where?: Prisma.NotificationWhereInput }): Promise<number> {
    return this.prisma.notification.count({ where: { ...args?.where, organizationId: this.organizationId } });
  }

  async create(data: NotificationCreateData): Promise<Notification> {
    return this.prisma.notification.create({ data: { ...data, organizationId: this.organizationId } });
  }

  // Phase D.2 correctness fix: atomic create-or-no-op, keyed on the
  // caller-computed dedupeKey — the DB's own unique constraint on that
  // column (see schema.prisma's comment on Notification.dedupeKey) is what
  // makes this race-free under concurrent execution, not application
  // logic. `update: {}` is deliberate — if a row for this exact key
  // already exists, it's a genuine duplicate attempt (e.g. two concurrent
  // reconciliation runs for the same org), and it must be left completely
  // untouched: not its message, and definitely not its `read` flag, which
  // the recipient may have already legitimately set.
  async upsertByDedupeKey(data: NotificationUpsertByDedupeKeyData): Promise<Notification> {
    try {
      return await this.prisma.notification.upsert({
        where: { dedupeKey: data.dedupeKey },
        create: { ...data, organizationId: this.organizationId },
        update: {},
      });
    } catch (error) {
      // Under genuinely simultaneous execution, two concurrent upserts can
      // both miss the existing row and both attempt the create branch —
      // the unique constraint on dedupeKey guarantees only one of them
      // can actually insert, but the loser surfaces this as a raw P2002
      // here rather than transparently falling into its own update branch
      // (a known upsert() characteristic under true concurrency, not a
      // gap in the constraint — the data-integrity guarantee still held:
      // exactly one row exists either way). The loser lost a race for a
      // row that now definitely exists, so fetching and returning it is
      // the correct outcome, not a fallback guess.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.notification.findUniqueOrThrow({ where: { dedupeKey: data.dedupeKey } });
      }
      throw error;
    }
  }

  async markRead(id: string): Promise<Notification | null> {
    const result = await this.prisma.notification.updateMany({
      where: { id, organizationId: this.organizationId },
      data: { read: true },
    });
    if (result.count === 0) return null;
    return this.findFirstById(id);
  }

  // Scoped to a single user — ADR-0021's "mark all read" is per-recipient,
  // never a cross-user bulk operation.
  async markAllReadForUser(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { organizationId: this.organizationId, userId, read: false },
      data: { read: true },
    });
    return result.count;
  }
}
