import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/auth.decorators';
import { BenefitsService } from './benefits.service';

@Injectable()
export class HrAnalyticsService {
  constructor(
    private db: PrismaService,
    private benefits: BenefitsService,
  ) {}
  async summary(
    user: AuthUser,
    companyId: string,
    jobId?: string,
    from = new Date(0),
    to = new Date(),
  ) {
    await this.benefits.member(user, companyId);
    return this.db.$transaction((db) => this.readSummary(db, companyId, jobId, from, to), {
      isolationLevel: 'RepeatableRead',
      maxWait: 15000,
      timeout: 30000,
    });
  }
  private async readSummary(
    db: Prisma.TransactionClient,
    companyId: string,
    jobId: string | undefined,
    from: Date,
    to: Date,
  ) {
    if (
      jobId &&
      !(await db.jobPost.findFirst({ where: { id: jobId, companyId }, select: { id: true } }))
    )
      throw new NotFoundException('Job not found in this company');
    const scope = Prisma.sql`j."companyId"=${companyId} ${jobId ? Prisma.sql`AND j.id=${jobId}` : Prisma.empty}`;
    const flags = await this.benefits.enabled('hr_packages', db);
    const entitlement = await db.jobPublicationPeriod.findMany({
      where: { companyId, ...(jobId ? { jobId } : {}) },
      select: { jobId: true, code: true },
    });
    const conversions = flags && entitlement.some((row) => row.code !== 'FREE');
    const reports = flags && entitlement.some((row) => row.code === 'PREMIUM');
    const entitledAt = (time: Prisma.Sql, premium = false) => Prisma.sql`EXISTS (
      SELECT 1 FROM "JobPublicationPeriod" period WHERE period."jobId"=j.id
      AND ${premium ? Prisma.sql`period.code='PREMIUM'` : Prisma.sql`period.code IN ('STANDARD','PREMIUM')`}
      AND ${time}>=period."startsAt" AND ${time}<period."expiresAt")`;
    const conversionScope = Prisma.sql`${scope} AND ${entitledAt(Prisma.sql`s."startedAt"`)}`;
    const premiumApplication = entitledAt(Prisma.sql`a."createdAt"`, true);
    const premiumSession = entitledAt(Prisma.sql`s."startedAt"`, true);
    const reportScope = Prisma.sql`${scope} AND EXISTS (SELECT 1 FROM "JobPublicationPeriod" period WHERE period."jobId"=j.id AND period.code='PREMIUM')`;
    const [
      status,
      events,
      historic,
      trend,
      applicationTrend,
      sessions,
      sources,
      stages,
      response,
      comparisons,
    ] = await Promise.all([
      db.$queryRaw<Array<{ status: string; count: number }>>(
        Prisma.sql`SELECT a.status,COUNT(*)::int count FROM "Application" a JOIN "JobPost" j ON j.id=a."jobPostId" WHERE ${scope} AND a."createdAt">=${from} AND a."createdAt"<=${to} GROUP BY a.status`,
      ),
      db.$queryRaw<Array<{ kind: string; count: number }>>(
        Prisma.sql`SELECT e.kind,COUNT(*)::int count FROM "JobEvent" e JOIN "JobFunnelSession" s ON s.id=e."sessionId" JOIN "JobPost" j ON j.id=s."jobId" WHERE ${scope} AND e."createdAt">=${from} AND e."createdAt"<=${to} GROUP BY e.kind`,
      ),
      db.$queryRaw<Array<{ count: number }>>(
        Prisma.sql`SELECT COUNT(*)::int count FROM "JobView" v JOIN "JobPost" j ON j.id=v."jobPostId" WHERE ${scope} AND v."createdAt">=${from} AND v."createdAt"<=${to}`,
      ),
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`SELECT to_char(e."createdAt",'YYYY-MM-DD') AS "day",COUNT(*)::int count FROM "JobEvent" e JOIN "JobFunnelSession" s ON s.id=e."sessionId" JOIN "JobPost" j ON j.id=s."jobId" WHERE ${scope} AND e.kind='DETAIL_VIEW' AND e."createdAt">=GREATEST(${from},${new Date(to.getTime() - 14 * 86400000)}) AND e."createdAt"<=${to} GROUP BY "day" ORDER BY "day"`,
      ),
      db.$queryRaw<Array<{ day: string; count: number }>>(
        Prisma.sql`SELECT to_char(a."createdAt",'YYYY-MM-DD') AS "day",COUNT(*)::int count FROM "Application" a JOIN "JobPost" j ON j.id=a."jobPostId" WHERE ${scope} AND a."createdAt">=GREATEST(${from},${new Date(to.getTime() - 14 * 86400000)}) AND a."createdAt"<=${to} GROUP BY "day" ORDER BY "day"`,
      ),
      conversions
        ? db.$queryRaw<Array<{ kind: string; count: number }>>(
            Prisma.sql`SELECT e.kind,COUNT(*)::int count FROM "JobEvent" e JOIN "JobFunnelSession" s ON s.id=e."sessionId" JOIN "JobPost" j ON j.id=s."jobId" WHERE ${conversionScope} AND s."sessionKey" NOT LIKE 'server:%' AND s."startedAt">=${from} AND s."startedAt"<=${to} AND e."createdAt"<=LEAST(s."expiresAt",${to}) GROUP BY e.kind`,
          )
        : [],
      conversions
        ? db.$queryRaw<Array<{ source: string; count: number; applications: number }>>(
            Prisma.sql`SELECT s.source,COUNT(*)::int count,COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM "JobEvent" e WHERE e."sessionId"=s.id AND e.kind='APPLICATION_SUBMITTED' AND e."createdAt"<=LEAST(s."expiresAt",${to})))::int applications FROM "JobFunnelSession" s JOIN "JobPost" j ON j.id=s."jobId" WHERE ${conversionScope} AND s."sessionKey" NOT LIKE 'server:%' AND s."startedAt">=${from} AND s."startedAt"<=${to} GROUP BY s.source`,
          )
        : [],
      reports
        ? db.$queryRaw<Array<{ status: string; count: number }>>(
            Prisma.sql`SELECT e."toStatus" status,COUNT(DISTINCT a.id)::int count FROM "PipelineEvent" e JOIN "Application" a ON a.id=e."applicationId" JOIN "JobPost" j ON j.id=a."jobPostId" WHERE ${reportScope} AND ${premiumApplication} AND a."createdAt">=${from} AND a."createdAt"<=${to} AND e."createdAt"<=${to} GROUP BY e."toStatus"`,
          )
        : [],
      reports
        ? db.$queryRaw<
            Array<{
              medianHours: number | null;
              answered: number;
              waitingOverSla: number;
              medianHireHours: number | null;
            }>
          >(
            Prisma.sql`WITH durations AS (SELECT a.id,a.status,a."createdAt",(SELECT MIN(e."createdAt") FROM "PipelineEvent" e WHERE e."applicationId"=a.id AND e."actorUserId" IS DISTINCT FROM p."userId" AND e."actorUserId" IS NOT NULL AND e."toStatus" NOT IN ('NEW','WITHDRAWN') AND e."createdAt"<=${to}) first,(SELECT MIN(e."createdAt") FROM "PipelineEvent" e WHERE e."applicationId"=a.id AND e."toStatus"='HIRED' AND e."createdAt"<=${to}) hired FROM "Application" a JOIN "EmployeeProfile" p ON p.id=a."profileId" JOIN "JobPost" j ON j.id=a."jobPostId" WHERE ${reportScope} AND ${premiumApplication} AND a."createdAt">=${from} AND a."createdAt"<=${to}) SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM(first-"createdAt"))/3600) "medianHours",COUNT(first)::int answered,COUNT(*) FILTER(WHERE first IS NULL AND status='NEW' AND "createdAt"<${to}-INTERVAL '48 hours')::int "waitingOverSla",percentile_cont(0.5) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(hired-"createdAt"))/3600) "medianHireHours" FROM durations`,
          )
        : [],
      reports
        ? db.$queryRaw<
            Array<{
              jobId: string;
              title: string;
              applications: number;
              hired: number;
              inReview: number;
              interview: number;
              offer: number;
              rejected: number;
              firstResponseHours: number | null;
              hireHours: number | null;
              impressions: number;
              detailViews: number;
              applyClicks: number;
              formsOpened: number;
              attributedApplications: number;
            }>
          >(
            Prisma.sql`SELECT j.id "jobId",j.title,COUNT(a.id)::int applications,
  COUNT(a.id) FILTER(WHERE h.hired IS NOT NULL)::int hired,
  COUNT(a.id) FILTER(WHERE h.review IS NOT NULL)::int "inReview",
  COUNT(a.id) FILTER(WHERE h.interview IS NOT NULL)::int interview,
  COUNT(a.id) FILTER(WHERE h.offer IS NOT NULL)::int offer,
  COUNT(a.id) FILTER(WHERE h.rejected IS NOT NULL)::int rejected,
  percentile_cont(0.5) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(h.first-a."createdAt"))/3600) "firstResponseHours",
  percentile_cont(0.5) WITHIN GROUP(ORDER BY EXTRACT(EPOCH FROM(h.hired-a."createdAt"))/3600) "hireHours",
  COALESCE(MAX(v.impressions),0)::int impressions,COALESCE(MAX(v.details),0)::int "detailViews",COALESCE(MAX(v.clicks),0)::int "applyClicks",COALESCE(MAX(v.forms),0)::int "formsOpened",COALESCE(MAX(v.submissions),0)::int "attributedApplications"
  FROM "JobPost" j
  LEFT JOIN "Application" a ON a."jobPostId"=j.id AND ${premiumApplication} AND a."createdAt">=${from} AND a."createdAt"<=${to}
  LEFT JOIN "EmployeeProfile" p ON p.id=a."profileId"
  LEFT JOIN LATERAL(SELECT
    MIN(e."createdAt") FILTER(WHERE e."toStatus"='HIRED') hired,
    MIN(e."createdAt") FILTER(WHERE e."toStatus"='IN_REVIEW') review,
    MIN(e."createdAt") FILTER(WHERE e."toStatus"='INTERVIEW') interview,
    MIN(e."createdAt") FILTER(WHERE e."toStatus"='OFFER') offer,
    MIN(e."createdAt") FILTER(WHERE e."toStatus"='REJECTED') rejected,
    MIN(e."createdAt") FILTER(WHERE e."actorUserId" IS NOT NULL AND e."actorUserId" IS DISTINCT FROM p."userId" AND e."toStatus" NOT IN ('NEW','WITHDRAWN')) first
    FROM "PipelineEvent" e WHERE e."applicationId"=a.id AND e."createdAt"<=${to}) h ON true
  LEFT JOIN LATERAL(SELECT COUNT(*) FILTER(WHERE e.kind='IMPRESSION') impressions,COUNT(*) FILTER(WHERE e.kind='DETAIL_VIEW') details,COUNT(*) FILTER(WHERE e.kind='APPLY_CLICK') clicks,COUNT(*) FILTER(WHERE e.kind='APPLY_START') forms,COUNT(*) FILTER(WHERE e.kind='APPLICATION_SUBMITTED') submissions
    FROM "JobFunnelSession" s JOIN "JobEvent" e ON e."sessionId"=s.id WHERE s."jobId"=j.id AND ${premiumSession} AND s."sessionKey" NOT LIKE 'server:%' AND s."startedAt">=${from} AND s."startedAt"<=${to} AND e."createdAt"<=LEAST(s."expiresAt",${to})) v ON true
  WHERE ${reportScope} GROUP BY j.id ORDER BY j.id`,
          )
        : [],
    ]);
    const counts = Object.fromEntries(events.map((row) => [row.kind, row.count]));
    const statuses = Object.fromEntries(status.map((row) => [row.status, row.count]));
    const reached = Object.fromEntries(stages.map((row) => [row.status, row.count]));
    const totalApplications = status.reduce((sum, row) => sum + row.count, 0);
    const funnel = {
      views: counts.DETAIL_VIEW ?? 0,
      applications: totalApplications,
      inReview: reached.IN_REVIEW ?? 0,
      interview: reached.INTERVIEW ?? 0,
      offer: reached.OFFER ?? 0,
      hired: reached.HIRED ?? 0,
      rejected: reached.REJECTED ?? 0,
    };
    return {
      views: counts.DETAIL_VIEW ?? 0,
      historicalViews: historic[0]?.count ?? 0,
      events: counts,
      applicationsByStatus: statuses,
      totalApplications,
      funnel,
      sources,
      responseTime: response[0] ?? {
        medianHours: null,
        answered: 0,
        waitingOverSla: 0,
        medianHireHours: null,
      },
      trend: { days: 14, views: trend, applications: applicationTrend },
      conversion: conversions
        ? Object.fromEntries(sessions.map((row) => [row.kind, row.count]))
        : null,
      conversionSessions: conversions ? sources.reduce((sum, row) => sum + row.count, 0) : null,
      comparisons,
      capabilities: { conversions, reports },
      metadata: {
        timezone: 'UTC',
        attributionDays: 7,
        cohort: 'session-start',
        from: from.toISOString(),
        to: to.toISOString(),
        historicalViewsAreNotImpressions: true,
        eligibleConversionJobs: new Set(entitlement.filter((row) => row.code !== 'FREE').map(row => row.jobId)).size,
        eligibleReportJobs: new Set(entitlement.filter((row) => row.code === 'PREMIUM').map(row => row.jobId)).size,
      },
    };
  }
  async csv(user: AuthUser, companyId: string, jobId?: string, from?: Date, to?: Date) {
    const report = await this.summary(user, companyId, jobId, from, to);
    if (!report.capabilities.reports)
      throw new ForbiddenException('Premium report access required');
    const cell = (value: unknown) =>
      '"' +
      String(value ?? '')
        .replace(/^[\u0000-\u0020]*[=+@-]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    return (
      '\uFEFF' +
      [
        [
          'Job ID',
          'Title',
          'Applications',
          'Reached in review',
          'Reached interview',
          'Reached offer',
          'Reached hired',
          'Reached rejected',
          'Median first HR action (hours)',
          'Median time to hire (hours)',
          'Session card impressions',
          'Session detail views',
          'Session apply clicks',
          'Session forms opened',
          'Attributed applications',
          'From UTC',
          'To UTC',
          'Timezone',
          'Attribution days',
        ],
        ...report.comparisons.map((row) => [
          row.jobId,
          row.title,
          row.applications,
          row.inReview,
          row.interview,
          row.offer,
          row.hired,
          row.rejected,
          row.firstResponseHours,
          row.hireHours,
          row.impressions,
          row.detailViews,
          row.applyClicks,
          row.formsOpened,
          row.attributedApplications,
          report.metadata.from,
          report.metadata.to,
          'UTC',
          7,
        ]),
      ]
        .map((row) => row.map(cell).join(','))
        .join('\r\n')
    );
  }
}
