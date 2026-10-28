import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { reportResolutionSchema, reportSchema } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  JwtAuthGuard,
  Roles,
  RolesGuard,
  CurrentUser,
  AuthUser,
} from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(reportSchema, body);

    if (data.entityType === 'CHAT_MESSAGE') {
      const message = await this.prisma.chatMessage.findUnique({
        where: { id: data.entityId },
        select: {
          senderId: true,
          conversation: { select: { userAId: true, userBId: true } },
        },
      });
      if (!message) throw new NotFoundException('Reported message not found');
      if (
        message.senderId === user.id ||
        (message.conversation.userAId !== user.id && message.conversation.userBId !== user.id)
      ) {
        throw new ForbiddenException('You can only report another participant\'s message');
      }
    } else {
      const exists =
        data.entityType === 'JOB_POST'
          ? await this.prisma.jobPost.findUnique({ where: { id: data.entityId }, select: { id: true } })
          : data.entityType === 'COMPANY'
            ? await this.prisma.company.findUnique({ where: { id: data.entityId }, select: { id: true } })
            : await this.prisma.user.findUnique({ where: { id: data.entityId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Reported item not found');
      if (data.entityType === 'USER' && data.entityId === user.id) {
        throw new BadRequestException('You cannot report your own account');
      }
    }

    const [openReports, duplicate] = await Promise.all([
      this.prisma.report.count({ where: { reporterId: user.id, status: 'OPEN' } }),
      this.prisma.report.findFirst({
        where: {
          reporterId: user.id,
          entityType: data.entityType,
          entityId: data.entityId,
          status: 'OPEN',
        },
        select: { id: true },
      }),
    ]);
    if (duplicate) throw new BadRequestException('You already have an open report for this item');
    if (openReports >= 10) {
      throw new BadRequestException('Resolve your existing reports before submitting more');
    }

    return this.prisma.report.create({
      data: {
        reporterId: user.id,
        entityType: data.entityType,
        entityId: data.entityId,
        reason: data.reason,
      },
    });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  list() {
    return this.prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, email: true, fullName: true } },
      },
      take: 100,
    });
  }

  @Post(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ) {
    const data = parseDto(reportResolutionSchema, body);
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.report.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: data.status, resolution: data.resolution },
      });
      if (!claimed.count) {
        const existing = await tx.report.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new NotFoundException('Report not found');
        throw new BadRequestException('Report was already resolved');
      }
      const report = await tx.report.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'RESOLVE_REPORT',
          entityType: 'Report',
          entityId: id,
          metadata: { status: data.status },
        },
      });
      return report;
    });
  }
}
