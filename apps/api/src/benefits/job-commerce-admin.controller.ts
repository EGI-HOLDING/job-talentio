import { Controller, Get, Param, Query, UseGuards, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard, Roles, RolesGuard } from '../common/auth.decorators';
import { parseDto } from '../common/utils';
import { PrismaService } from '../prisma/prisma.service';
@Controller('admin/job-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class JobCommerceAdminController {
  constructor(private db: PrismaService) {}
  @Get()
  async list(@Query() query: unknown) {
    const input = parseDto(z.object({page: z.coerce.number().int().min(1).max(100000).default(1),
      status: z.enum(['PENDING','PAID','CANCELLED','EXPIRED','REVIEW']).optional(), q: z.string().trim().max(160).optional()}), query);
    const where: Prisma.JobPurchaseOrderWhereInput = {...(input.status ? {status: input.status} : {}), ...(input.q ? {OR: [
      {id: {contains: input.q, mode: 'insensitive'}}, {companyName: {contains: input.q, mode: 'insensitive'}}, {jobTitle: {contains: input.q, mode: 'insensitive'}},
    ]} : {})};
    const [items, total] = await this.db.$transaction([
      this.db.jobPurchaseOrder.findMany({where, orderBy: [{createdAt: 'desc'}, {id: 'desc'}], take: 20, skip: (input.page - 1) * 20}),
      this.db.jobPurchaseOrder.count({where}),
    ]);
    return {items, total, page: input.page, limit: 20};
  }
  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await this.db.jobPurchaseOrder.findUnique({where: {id}, include: {events: {orderBy: {createdAt: 'asc'}}}});
    if (!row) throw new NotFoundException('Order not found');
    return row;
  }
}
