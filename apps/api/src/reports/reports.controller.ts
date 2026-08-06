import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { reportSchema } from '@job-talentio/shared';
import { ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, Roles, RolesGuard, CurrentUser, AuthUser } from '../common/auth.decorators';
import { parseDto } from '../common/utils';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const data = parseDto(reportSchema, body);
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
    @Body() body: { status: ReportStatus; resolution?: string },
  ) {
    return this.prisma.report.update({
      where: { id },
      data: {
        status: body.status ?? 'RESOLVED',
        resolution: body.resolution,
      },
    });
  }
}
