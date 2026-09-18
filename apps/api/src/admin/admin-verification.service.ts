import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, VerificationStatus } from '@prisma/client';
import type { z } from 'zod';
import type { adminVerificationListSchema } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { dateRange, enumFilter, envelope, inFilter, skipFor } from './admin-query';

type ListQuery = z.infer<typeof adminVerificationListSchema>;

const STATUSES: VerificationStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const DOCUMENT_URL_TTL_SECONDS = 15 * 60;

/** Review queue for the verified-employer badge. */
@Injectable()
export class AdminVerificationService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private notifications: NotificationsService,
  ) {}

  async list(query: ListQuery) {
    const statuses = enumFilter(query.status, STATUSES);
    const where: Prisma.CompanyVerificationRequestWhereInput = {
      status: inFilter(statuses),
      createdAt: dateRange(query.createdFrom, query.createdTo),
      ...(query.q
        ? {
            OR: [
              { legalName: { contains: query.q, mode: 'insensitive' } },
              { taxId: { contains: query.q, mode: 'insensitive' } },
              { company: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.companyVerificationRequest.findMany({
        where,
        orderBy: query.sort === 'status' ? [{ status: query.dir }, { createdAt: 'desc' }] : { createdAt: query.dir },
        skip: skipFor(query.page, query.limit),
        take: query.limit,
        include: {
          company: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
          submittedBy: { select: { id: true, email: true, fullName: true } },
          reviewedBy: { select: { id: true, email: true, fullName: true } },
        },
      }),
      this.prisma.companyVerificationRequest.count({ where }),
    ]);
    const items = await Promise.all(
      rows.map(async ({ documentKey, ...row }) => ({
        ...row,
        documentUrl: documentKey
          ? await this.storage.getPresignedGetUrl(documentKey, DOCUMENT_URL_TTL_SECONDS).catch(() => null)
          : null,
      })),
    );
    return envelope(items, total, query.page, query.limit);
  }

  pendingCount() {
    return this.prisma.companyVerificationRequest.count({ where: { status: 'PENDING' } });
  }

  /** Approve grants the badge; reject leaves the company as it was and tells the submitter why. */
  async decide(actorId: string, id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) {
    const request = await this.prisma.companyVerificationRequest.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!request) throw new NotFoundException('Verification request not found');
    if (request.status !== 'PENDING') {
      throw new BadRequestException('This request was already reviewed');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.companyVerificationRequest.update({
        where: { id },
        data: {
          status,
          reviewNote: reviewNote?.trim() || null,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
      });
      if (status === 'APPROVED') {
        await tx.company.update({ where: { id: request.companyId }, data: { isVerified: true } });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: status === 'APPROVED' ? 'APPROVE_COMPANY_VERIFICATION' : 'REJECT_COMPANY_VERIFICATION',
          entityType: 'Company',
          entityId: request.companyId,
          metadata: { requestId: id, taxId: request.taxId, reviewNote: reviewNote?.trim() || null },
        },
      });
      return row;
    });

    if (request.submittedById) {
      const note = reviewNote?.trim();
      await this.notifications
        .create({
          userId: request.submittedById,
          type: 'SYSTEM',
          title: status === 'APPROVED' ? 'Company verified' : 'Verification request declined',
          body: `${request.company.name}${note ? `: ${note}` : ''}`,
          titleKey:
            status === 'APPROVED' ? 'notify.verification.approved.title' : 'notify.verification.rejected.title',
          bodyKey:
            status === 'APPROVED'
              ? 'notify.verification.approved.body'
              : note
                ? 'notify.verification.rejected.body'
                : 'notify.verification.rejected.bodyNoNote',
          params: { company: request.company.name, note: note ?? '' },
          linkUrl: '/dashboard/recruiter?tab=company',
        })
        .catch(() => undefined);
    }

    return updated;
  }
}
