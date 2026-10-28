import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { JobEventKind, Prisma } from '@prisma/client';
import { AuthUser } from '../common/auth.decorators';
import { resolveJwtSecret } from '../common/jwt-secret';
import { PrismaService } from '../prisma/prisma.service';
import { BenefitsService } from './benefits.service';
import { DAY_MS, liveJobWhere } from './benefit-policy';

@Injectable()
export class HrEventsService {
  constructor(
    private db: PrismaService,
    private benefits: BenefitsService,
    private config: ConfigService,
  ) {}
  private sign(id: string) {
    return createHmac('sha256', resolveJwtSecret(this.config))
      .update('hr-session:' + id)
      .digest('hex');
  }
  async track(
    input: {
      jobId: string;
      visitor: string;
      kind: Exclude<JobEventKind, 'APPLICATION_SUBMITTED'>;
      source?: string;
    },
    user?: AuthUser,
    agent = '',
  ) {
    if (!(await this.benefits.enabled('hr_analytics'))) return { ignored: true };
    if (
      /bot|crawler|spider|headless|preview|facebookexternalhit/i.test(agent) ||
      user?.role === 'SUPER_ADMIN'
    )
      return { ignored: true };
    const job = await this.db.jobPost.findFirst({
      where: { id: input.jobId, ...liveJobWhere() },
      select: { companyId: true },
    });
    if (
      !job ||
      (user &&
        (await this.db.companyMember.findUnique({
          where: { companyId_userId: { companyId: job.companyId, userId: user.id } },
        })))
    )
      return { ignored: true };
    const visitorHash = createHmac('sha256', resolveJwtSecret(this.config))
      .update('hr-visitor:' + input.visitor)
      .digest('hex');
    const sessionKey = createHash('sha256')
      .update(input.jobId + ':' + visitorHash + ':' + Math.floor(Date.now() / 1_800_000))
      .digest('hex');
    const now = new Date();
    const session = await this.db.jobFunnelSession.upsert({
      where: { sessionKey },
      create: {
        sessionKey,
        visitorHash,
        jobId: input.jobId,
        source: input.source?.toLowerCase().slice(0, 40) || 'direct',
        startedAt: now,
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      },
      update: {},
    });
    await this.db.jobEvent.createMany({
      data: [{ sessionId: session.id, kind: input.kind }],
      skipDuplicates: true,
    });
    return { session: session.id + '.' + this.sign(session.id), attributionDays: 7 };
  }
  async submitted(
    tx: Prisma.TransactionClient,
    application: { id: string; jobPostId: string },
    token?: string,
  ) {
    if (!(await this.benefits.enabled('hr_analytics', tx))) return;
    const [id, signature] = token?.split('.') ?? [];
    let session =
      id &&
      signature &&
      /^[0-9a-f]{64}$/.test(signature) &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(id)))
        ? await tx.jobFunnelSession.findFirst({
            where: { id, jobId: application.jobPostId, expiresAt: { gt: new Date() } },
          })
        : null;
    // A successful application is always recorded by the server. Without a
    // valid visit, keep it explicitly unattributed and never invent a view.
    if (!session) {
      const now = new Date();
      session = await tx.jobFunnelSession.upsert({
        where: { sessionKey: 'server:' + application.id },
        create: {
          sessionKey: 'server:' + application.id,
          jobId: application.jobPostId,
          visitorHash: createHash('sha256').update(application.id).digest('hex'),
          source: 'unattributed',
          startedAt: now,
          expiresAt: new Date(now.getTime() + 7 * DAY_MS),
        },
        update: {},
      });
    }
    await tx.application.update({
      where: { id: application.id },
      data: { funnelSessionId: session.id },
    });
    await tx.jobEvent.createMany({
      data: [
        { sessionId: session.id, kind: 'APPLICATION_SUBMITTED', applicationId: application.id },
      ],
      skipDuplicates: true,
    });
  }
}
