import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { BenefitsService } from './benefits.service';
import { OperationsService } from './operations.service';
import { Prisma, SupportTicketStatus } from '@prisma/client';
@Injectable()
export class HrSupportService {
  constructor(
    private db: PrismaService,
    private benefits: BenefitsService,
    private operations: OperationsService,
  ) {}
  private async access(user: AuthUser, companyId?: string) {
    await this.benefits.assertEnabled('hr_support');
    if (user.role !== 'SUPER_ADMIN' && !companyId)
      throw new ForbiddenException('Company context required');
    if (companyId) await this.benefits.member(user, companyId);
  }
  async list(user: AuthUser, companyId?: string, page = 1, status?: SupportTicketStatus | 'ALL') {
    await this.access(user, companyId);
    const where: Prisma.SupportTicketWhereInput = {
      ...(companyId ? { companyId } : {}),
      ...(status === 'ALL' ? {} : status ? { status } : { status: { not: 'RESOLVED' } }),
    };
    const [items, total] = await Promise.all([
      this.db.supportTicket.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * 20,
        take: 20,
        include: { company: { select: { name: true } }, _count: { select: { replies: true } } },
      }),
      this.db.supportTicket.count({ where }),
    ]);
    return { items, total, page, limit: 20 };
  }
  async get(user: AuthUser, id: string, page = 1) {
    const ticket = await this.db.supportTicket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException();
    await this.access(user, ticket.companyId);
    const replies = await this.db.supportReply.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * 50,
      take: 50,
    });
    return {
      ...ticket,
      replies,
      page,
      total: await this.db.supportReply.count({ where: { ticketId: id } }),
    };
  }
  async create(
    user: AuthUser,
    input: { companyId: string; jobId?: string; title: string; body: string },
    key?: string,
  ) {
    await this.access(user, input.companyId);
    if (
      input.jobId &&
      !(await this.db.jobPost.findFirst({ where: { id: input.jobId, companyId: input.companyId } }))
    )
      throw new NotFoundException();
    return (
      await this.operations.transaction(
        'support:' + input.companyId,
        key,
        { actorId: user.id, ...input },
        async (db) => {
          const priority =
            (await this.benefits.enabled('hr_packages', db)) &&
            (await db.jobBenefit.count({
              where: {
                companyId: input.companyId,
                code: 'PREMIUM',
                startsAt: { lte: new Date() },
                expiresAt: { gt: new Date() },
                job: { status: { in: ['PUBLISHED', 'PAUSED'] } },
              },
            })) > 0;
          return db.supportTicket.create({
            data: {
              companyId: input.companyId,
              jobId: input.jobId,
              createdById: user.id,
              title: input.title,
              priority,
              replies: { create: { body: input.body, authorId: user.id, authorRole: user.role } },
            },
          });
        },
      )
    ).value;
  }
  async reply(user: AuthUser, id: string, body: string, key?: string) {
    const ticket = await this.get(user, id);
    return (
      await this.operations.transaction(
        'support-reply:' + id,
        key,
        { actorId: user.id, body },
        async (db) => {
          const reply = await db.supportReply.create({
            data: { ticketId: id, authorId: user.id, authorRole: user.role, body },
          });
          await db.supportTicket.update({
            where: { id },
            data: { status: user.role === 'SUPER_ADMIN' ? 'WAITING_HR' : 'OPEN' },
          });
          return reply;
        },
      )
    ).value;
  }
  async update(
    user: AuthUser,
    id: string,
    input: {
      status: 'OPEN' | 'IN_PROGRESS' | 'WAITING_HR' | 'RESOLVED';
      assignedToId?: string | null;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    await this.get(user, id);
    if (
      input.assignedToId &&
      !(await this.db.user.findFirst({
        where: { id: input.assignedToId, role: 'SUPER_ADMIN', isBanned: false, anonymizedAt: null },
      }))
    )
      throw new ForbiddenException('An active Super Admin must own this ticket');
    return this.db.$transaction(async (db) => {
      const ticket = await db.supportTicket.update({ where: { id }, data: input });
      await db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'SUPPORT_TICKET_UPDATED',
          entityType: 'SupportTicket',
          entityId: id,
          metadata: input,
        },
      });
      return ticket;
    });
  }
}
