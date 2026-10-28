import {
  Injectable,
  Optional,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { DEFAULT_PIPELINE, isMessageKey, translateMessage } from '@job-talentio/shared';
import type { MessageLocale } from '@job-talentio/shared';
import { HrEventsService } from '../benefits/hr-events.service';
import { OperationsService } from '../benefits/operations.service';
import { recruiterProfileInclude } from '../matching/recruiter-matching.service';
import { compareRecruiterMatches, type RecruiterBreakdown } from '../matching/recruiter-matching';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { MailService } from '../mail/mail.service';
import { emailLocale } from '../common/i18n/email-locale';
import { escapeHtml } from '../common/utils';
import { resolveUgcContent } from '../common/i18n/content-locale';
import { DEFAULT_LOCALE } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { maskAnonymousCompany, revealsAnonymousEmployer } from '../common/anonymous-job';
import { ApplicantFilters, applicantFilter } from './applicant-filter';
import { canAddToKanban, safeApplication, submittedResume } from './application-payload';

function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
}
type ApplicationWindow = { ids:string[]; scores:Map<string,RecruiterBreakdown>;total:number;page:number;totalPages:number };

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private companies: CompaniesService,
    private matching: MatchingService,
    private notifications: NotificationsService,
    private mail: MailService,
    @Optional() private operations?: OperationsService,
    @Optional() private hrEvents?: HrEventsService,
  ) {}

  /** PostgreSQL can reject a consistent snapshot when background counters or
   * CV processing touch a locked row. The transaction has no external side
   * effects, so retry it with a fresh snapshot before asking the user to retry. */
  private async applyTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(run, { isolationLevel: 'RepeatableRead', timeout: 30000 }); }
      catch (error) {
        if (!isTransactionConflict(error) || attempt >= 3) throw error;
        this.logger.warn(`Retrying application transaction after database conflict (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
      }
    }
  }

  async apply(
    user: AuthUser,
    jobPostId: string,
    coverLetter?: string,
    answers?: Array<{ questionId: string; answer: string }>,
    resumeId?: string,
    source?: string,
    locale: Locale = DEFAULT_LOCALE,
    funnelSession?: string,
  ) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only employees can apply');
    }
    try {
      const { application, job, breakdown } = await this.applyTransaction(async tx => {
        const target = await tx.jobPost.findUnique({where:{id:jobPostId},select:{companyId:true}});
        if(!target)throw new NotFoundException('Job not available');
        // Same lock order as publication and benefit changes: company before job.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "Company" WHERE id=${target.companyId} FOR SHARE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE "userId"=${user.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM "JobPost" WHERE id=${jobPostId} FOR UPDATE`);
    const profile = await tx.employeeProfile.findUnique({
      where: { userId: user.id },
      include: {
        skills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
        experiences: true,
        educations: true,
        languages: { include: { language: true } }, certifications: true, preferredCountries: true, city: { include: { province: true } },
        resumes: { where: { deletedAt: null } },
      },
    });
    if (!profile) throw new BadRequestException('Complete your employee profile first');

    const job = await tx.jobPost.findUnique({
      where: { id: jobPostId },
      include: {
        jobTitle: { select: { name: true, nameRu: true, nameUz: true, nameId: true, normalizedKey: true, aliases: { select: { aliasKey: true } } } },
        jobSkills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
        jobLanguages: { include: { language: true } }, city: { include: { province: true } },
        questions: { where: { archivedAt: null } },
        benefit: true,
        company: { include: { members: { where: { role: { in: ['OWNER', 'ADMIN'] } }, take: 5 } } },
      },
    });
    if (
      !job ||
      job.status !== 'PUBLISHED' ||
      job.company.isBanned ||
      job.company.anonymizedAt ||
      (job.benefit?.expiresAt && job.benefit.expiresAt <= new Date())
    ) {
      throw new NotFoundException('Job not available');
    }

    // Pre-check: one application per employee per job (also enforced by @@unique)
    const existing = await tx.application.findUnique({
      where: { jobPostId_profileId: { jobPostId, profileId: profile.id } },
      select: { id: true, status: true, createdAt: true },
    });
    if (existing) {
      throw new ConflictException(
        `You have already applied to this job (status: ${existing.status}).`,
      );
    }

    // Answers must belong to this job. Without this check, a caller can submit
    // another job's question id and attach the answer to this application.
    const questionIds = new Set(job.questions.map((question) => question.id));
    const suppliedQuestionIds = new Set<string>();
    for (const answer of answers || []) {
      if (!questionIds.has(answer.questionId)) {
        throw new BadRequestException('A screening answer does not belong to this job');
      }
      if (suppliedQuestionIds.has(answer.questionId)) {
        throw new BadRequestException('A screening question can only be answered once');
      }
      suppliedQuestionIds.add(answer.questionId);
      const question = job.questions.find(item => item.id === answer.questionId)!;
      const value = answer.answer.trim();
      if (value && question.type === 'YES_NO' && !/^(yes|no)$/i.test(value)) throw new BadRequestException('Answer must be Yes or No');
      if (value && question.type === 'NUMBER' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value)))) throw new BadRequestException('Answer must be a finite number');
    }

    // Validate required screening questions
    const answerMap = new Map((answers || []).map((a) => [a.questionId, a.answer]));
    for (const q of job.questions) {
      if (q.isRequired && !answerMap.get(q.id)?.trim()) {
        throw new BadRequestException(`Answer required for: ${q.question}`);
      }
    }

    let selectedResume =
      (resumeId
        ? profile.resumes.find((r) => r.id === resumeId)
        : profile.resumes.find((r) => r.isPrimary) || profile.resumes[0]) || null;

    if (resumeId && !selectedResume) {
      throw new BadRequestException('Selected resume not found');
    }
    if (profile.resumes.length > 0 && selectedResume && !selectedResume.fileKey) {
      throw new BadRequestException(
        'Export or upload a CV file for this resume before applying.',
      );
    }
    if (profile.resumes.length > 0 && !selectedResume) {
      throw new BadRequestException('Select a resume to apply with');
    }

    const breakdown = await this.matching.scoreInputs(profile, job, tx);

    const resumeSnapshot = {
      headline: profile.headline,
      summary: profile.summary,
      skills: profile.skills.map((s) => ({
        name: s.skill.name,
        slug: s.skill.slug,
        level: s.level,
      })),
      experiences: profile.experiences,
      educations: profile.educations,
      resume: selectedResume
        ? {
            id: selectedResume.id,
            title: selectedResume.title,
            hasFile: Boolean(selectedResume.fileKey),
            fileKey: selectedResume.fileKey ?? null,
            fileUrl: selectedResume.fileUrl ?? null,
            templateKey: selectedResume.templateKey,
          }
        : null,
      snapshotAt: new Date().toISOString(),
    };

      const application = await tx.application.create({
        data: {
          jobPostId,
          profileId: profile.id,
          resumeId: selectedResume?.id ?? null,
          coverLetter,
          source: source ? source.toLowerCase().slice(0, 40) : null,
          resumeSnapshot,
          matchScore: breakdown.total,
          matchBreakdown: breakdown,
          status: 'NEW',
          events: {
            create: {
              toStatus: 'NEW',
              note: 'Application submitted',
              actorUserId: user.id,
            },
          },
          answers: {
            create: (answers || [])
              .filter((a) => a.answer?.trim())
              .map((a) => ({
                questionId: a.questionId,
                questionRevision: job.questions.find(q => q.id === a.questionId)!.revision,
                questionSnapshot: JSON.parse(JSON.stringify(job.questions.find(q => q.id === a.questionId)!)),
                answer: a.answer.trim(),
              })),
          },
        },
        include: {
          jobPost: { include: { company: true } },
          answers: { include: { question: true } },
          resume: true,
        },
      });

        await this.hrEvents?.submitted(tx, application, funnelSession);
        return { application, job, breakdown };
      });
      for (const member of job.company.members) {
        try {
          await this.notifications.create({
            userId: member.userId,
            type: 'NEW_APPLICANT',
            title: `New applicant for ${job.title}`,
            body: `${user.fullName} applied (fit index ${breakdown.total}/100)`,
            titleKey: 'notify.newApplicant.title',
            bodyKey: 'notify.newApplicant.body',
            params: { job: job.title, name: user.fullName, match: breakdown.total },
            linkUrl: `/dashboard/recruiter/jobs/${job.id}?section=applicants&company=${job.companyId}&application=${application.id}`,
          });
        } catch (err) {
          this.logger.warn(`Applicant notification failed: ${(err as Error).message}`);
        }
      }

      return {
        ...safeApplication(application),
        jobPost: maskAnonymousCompany(application.jobPost, locale),
      };
    } catch (err) {
      if (isTransactionConflict(err)) throw new ConflictException('Profile, CV or job changed; refresh and submit again.');
      // Race: concurrent double-submit still blocked by unique(jobPostId, profileId)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You have already applied to this job.');
      }
      throw err;
    }
  }

  /** Employee: whether they already applied to this job (for UI guard). */
  async getMyApplicationForJob(user: AuthUser, jobPostId: string) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!profile) return { applied: false as const, application: null };

    const application = await this.prisma.application.findUnique({
      where: { jobPostId_profileId: { jobPostId, profileId: profile.id } },
      select: {
        id: true,
        status: true,
        matchScore: true,
        matchBreakdown: true,
        createdAt: true,
      },
    });

    return {
      applied: Boolean(application),
      application: application ?? null,
    };
  }

  async myApplications(user: AuthUser, locale: Locale = DEFAULT_LOCALE) {
    const profile = await this.prisma.employeeProfile.findUnique({ where: { userId: user.id } });
    if (!profile) return [];
    const rows = await this.prisma.application.findMany({
      where: { profileId: profile.id },
      include: {
        jobPost: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                members: {
                  where: { role: { in: ['OWNER', 'ADMIN'] } },
                  select: { userId: true, role: true },
                  take: 5,
                },
              },
            },
            city: true,
            country: true,
          },
        },
        events: { orderBy: { createdAt: 'desc' }, take: 5 },
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Expose a single chat peer — do not return the members array to clients
    return rows.map((app) => {
      const members = app.jobPost.company.members ?? [];
      const peer = members.find((m) => m.role === 'OWNER') ?? members[0];
      const { members: _members, ...company } = app.jobPost.company;
      // Confidential posting: the employer (and its chat) stays hidden until interview stage.
      const reveal = !app.jobPost.isAnonymous || revealsAnonymousEmployer(app.status);
      const jobPost = maskAnonymousCompany(
        { ...app.jobPost, company: { ...company, chatPeerUserId: reveal ? peer?.userId ?? null : null } },
        locale,
        { reveal },
      );
      return {
        ...safeApplication(app),
        jobPost,
      };
    });
  }

  async listForJob(
    user: AuthUser,
    jobPostId: string,
    opts?: { status?: string; sort?: 'match' | 'newest'; minMatch?: number; locale?: Locale; filters?: ApplicantFilters; page?: number; limit?: number; applicationId?: string; window?:ApplicationWindow; kanbanOnly?: boolean },
  ) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobPostId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);

    const locale = opts?.locale ?? DEFAULT_LOCALE;
    const where: Record<string, unknown> = { jobPostId };
    if (opts?.kanbanOnly) where.kanbanEnteredAt = { not: null };
    if (opts?.applicationId) where.id = opts.applicationId;
    if (opts?.filters) where.profile = await applicantFilter(this.prisma, opts.filters);
    if (opts?.status) where.status = opts.status;
    const window = opts?.window ?? await this.applicationWindow(where as Prisma.ApplicationWhereInput,jobPostId,opts);

    const rows = await this.prisma.application.findMany({
      where: {jobPostId,id:{in:window.ids}},
      include: {
        resume: { select: { id: true, title: true, fileKey: true } },
        profile: {
          include: {
            user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            skills: { include: { skill: true } },
            city: true,
            residenceCountry: true,
            experiences: true,
            educations: true,
            translations: { select: { locale: true, headline: true, isMachine: true } },
          },
        },
        events: { orderBy: { createdAt: 'desc' }, take: 10 },
        answers: { include: { question: true } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy:
        opts?.sort === 'newest'
          ? [{ createdAt: 'desc' }, { id: 'asc' }]
          : [{ matchScore: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
    const order = new Map(window.ids.map((id,index)=>[id,index]));
    rows.sort((a,b)=>order.get(a.id)!-order.get(b.id)!);

    return rows.map((row) => {
      const { resume, resumeSnapshot, profile, ...rest } = row;
      const snap = resumeSnapshot as
        | {
            resume?: { title?: string | null; fileKey?: string | null; hasFile?: boolean };
            [key: string]: unknown;
          }
        | null;
      const snapResume = snap?.resume;
      // An unrecorded historical file cannot be reconstructed from today's CV.
      const submitted = submittedResume(resumeSnapshot);
      const hasResumeFile = Boolean(submitted.fileKey);
      const safeSnapshot = safeApplication({ resumeSnapshot }).resumeSnapshot;
      const { translations, onboardingDraft: _unreviewedDraft, ...profileRest } = profile;
      const resolvedHeadline = resolveUgcContent(
        { headline: profileRest.headline ?? '' },
        profileRest.contentLocale,
        (translations ?? []).map((t) => ({
          locale: t.locale,
          headline: t.headline ?? '',
          isMachine: t.isMachine,
        })),
        locale,
        profileRest.headline ?? '',
      );
      return {
        ...safeApplication(rest),
        canAddToKanban: canAddToKanban(row),
        matchSnapshot: {score:row.matchScore,breakdown:row.matchBreakdown},
        matchScore: window.scores.get(row.id)?.total ?? null,
        matchBreakdown: window.scores.get(row.id) ?? null,
        profile: {
          ...profileRest,
          headline: resolvedHeadline.content.headline || profileRest.headline,
        },
        resumeSnapshot: safeSnapshot,
        resumeTitle: submitted.title,
        hasResumeFile,
      };
    });
  }

  private async applicationWindow(where:Prisma.ApplicationWhereInput,jobPostId:string,opts?:{sort?:'match'|'newest';minMatch?:number;page?:number;limit?:number;kanbanOnly?:boolean}):Promise<ApplicationWindow> {
    const newestOnly = opts?.sort==='newest' && opts.minMatch===undefined;
    const count = newestOnly ? await this.prisma.application.count({where}) : 0;
    const limit = opts?.limit ?? 12;
    const page = opts?.page ? Math.min(opts.page,Math.max(1,Math.ceil(count/limit))) : 1;
    const rows = await this.prisma.application.findMany({where,
      select:{id:true,createdAt:true,profile:{include:recruiterProfileInclude}},
      ...(newestOnly && opts?.page ? {skip:(page-1)*limit,take:limit}:{}),
      orderBy:[{createdAt:'desc'},{id:'asc'}],
    });
    const scores = opts?.kanbanOnly ? [] : await this.matching.scoreProfilesAgainstJob(rows.map(row=>row.profile),jobPostId);
    const byId = new Map(rows.flatMap((row,index)=>scores[index]?[[row.id,scores[index]] as const]:[]));
    let ranked = rows.filter(row=>opts?.minMatch===undefined || byId.get(row.id)!.total>=opts.minMatch);
    if (opts?.sort !== 'newest') ranked.sort((a,b)=>compareRecruiterMatches(byId.get(a.id)!,byId.get(b.id)!) || a.id.localeCompare(b.id));
    const total = newestOnly ? count : ranked.length;
    const totalPages = Math.max(1,Math.ceil(total/limit));
    const currentPage = opts?.page ? Math.min(opts.page,totalPages) : 1;
    if (!newestOnly && opts?.page) ranked=ranked.slice((currentPage-1)*limit,currentPage*limit);
    return {ids:ranked.map(row=>row.id),scores:byId,total,page:currentPage,totalPages};
  }

  async getForJob(user: AuthUser, jobPostId: string, applicationId: string, locale: Locale) {
    const rows = await this.listForJob(user, jobPostId, { applicationId, page: 1, limit: 1, locale });
    if (!rows[0]) throw new NotFoundException('Application not found in this job');
    return rows[0];
  }

  async searchForJob(user: AuthUser, jobPostId: string, input: ApplicantFilters & { status?: string; sort?: 'match' | 'newest'; minMatch?: number; page: number; limit: number; kanbanOnly?: boolean }, locale: Locale) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobPostId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);
    const where: Prisma.ApplicationWhereInput = { jobPostId, profile: await applicantFilter(this.prisma, input), ...(input.status ? { status: input.status as never } : {}), ...(input.kanbanOnly ? {kanbanEnteredAt:{not:null}} : {}) };
    const window = await this.applicationWindow(where,jobPostId,input);
    const items = await this.listForJob(user, jobPostId, { ...input, page:window.page, filters: input, locale,window });
    return { items, total:window.total, page:window.page, limit: input.limit, totalPages:window.totalPages };
  }

  async kanbanForJob(user: AuthUser, jobPostId: string, input: ApplicantFilters & { status?: string; page: number; limit: number }, locale: Locale) {
    const stages = input.status ? [input.status] : [...DEFAULT_PIPELINE];
    const columns = await Promise.all(stages.map(async status => {
      const result = await this.searchForJob(user, jobPostId, {...input, status, sort:'newest', kanbanOnly:true}, locale);
      return {status, ...result, hasMore:result.page < result.totalPages};
    }));
    return {columns};
  }

  async addToKanban(user: AuthUser, applicationId: string) {
    if (user.isBanned || !['RECRUITER','SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException('Employer access required');
    const application = await this.prisma.application.findUnique({where:{id:applicationId},include:{jobPost:true}});
    if (!application) throw new NotFoundException('Application not found');
    const {company} = await this.companies.assertMember(user,application.jobPost.companyId,['OWNER','ADMIN','RECRUITER']);
    if (company.isBanned || company.anonymizedAt) throw new ForbiddenException('Company unavailable');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUniqueOrThrow({where:{id:applicationId}});
      if (current.kanbanEnteredAt) return {...safeApplication(current),canAddToKanban:false};
      if (!canAddToKanban(current)) throw new ConflictException('A finalized application cannot enter Kanban');
      const updated = await tx.application.update({where:{id:applicationId},data:{kanbanEnteredAt:new Date()}});
      await tx.auditLog.create({data:{actorId:user.id,action:'APPLICATION_KANBAN_ADDED',entityType:'Application',entityId:applicationId,metadata:{companyId:application.jobPost.companyId,jobPostId:application.jobPostId}}});
      return {...safeApplication(updated),canAddToKanban:false};
    });
  }

  async updateStatus(
    user: AuthUser,
    applicationId: string,
    status: ApplicationStatus,
    note?: string,
    opts?: { notify?: boolean; skipStatusEmail?: boolean },
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        jobPost: true,
        profile: { include: { user: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    const isOwnerCandidate =
      application.profile.userId === user.id && status === 'WITHDRAWN';
    if (!isOwnerCandidate) {
      await this.companies.assertMember(user, application.jobPost.companyId, [
        'OWNER',
        'ADMIN',
        'RECRUITER',
      ]);
    }

    if (isOwnerCandidate && ['HIRED', 'REJECTED'].includes(application.status)) {
      throw new BadRequestException('A finalized application cannot be withdrawn');
    }
    if (application.status === 'WITHDRAWN' && status !== 'WITHDRAWN') {
      throw new BadRequestException('A withdrawn application cannot be reopened');
    }

    if (application.status === status) {
      // Keep retries consistent with the update response. The authorization
      // lookup includes a full user record which must never leave this service.
      const { profile: _profile, jobPost: _jobPost, ...result } = application;
      return safeApplication(result);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUniqueOrThrow({where:{id:applicationId}});
      if (current.status !== application.status) throw new ConflictException('Application status changed. Refresh and try again.');
      const claimed = await tx.application.updateMany({
        where: { id: applicationId, status: application.status },
        data: { status, ...(!isOwnerCandidate && !current.kanbanEnteredAt ? {kanbanEnteredAt:new Date()} : {}) },
      });
      if (!claimed.count) throw new ConflictException('Application status changed. Refresh and try again.');
      await tx.pipelineEvent.create({ data: {
        applicationId, fromStatus: application.status, toStatus: status, note, actorUserId: user.id,
      } });
      return tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
      });
    });

    if (opts?.notify !== false) {
      try {
        await this.notifications.create({
          userId: application.profile.userId,
          type: 'APPLICATION_STATUS',
          title: `Application update: ${application.jobPost.title}`,
          body: `Status is now ${status}${note ? `. Note: ${note}` : ''}`,
          titleKey: 'notify.applicationStatus.title',
          bodyKey: note
            ? 'notify.applicationStatus.bodyWithNote'
            : 'notify.applicationStatus.body',
          params: {
            job: application.jobPost.title,
            status,
            ...(note ? { note } : {}),
          },
          linkUrl: `/dashboard/employee?tab=applications`,
        });
      } catch (err) {
        this.logger.warn(`Application status notification failed: ${(err as Error).message}`);
      }
    }

    // Email only for recruiter forward (right) moves, and only if the
    // candidate has verified their platform email. Left moves / withdraw = in-app only.
    const shouldEmail =
      !isOwnerCandidate &&
      status !== 'WITHDRAWN' &&
      this.isForwardMove(application.status, status) &&
      Boolean(application.profile.user.emailVerified);

    if (shouldEmail && !opts?.skipStatusEmail) {
      const to = application.profile.user.email;
      if (to) {
        const { subject, html } = this.stageEmail(
          application.jobPost.title,
          status,
          note,
          emailLocale(application.profile.user.locale),
        );
        void this.mail.send(to, subject, html);
      }
    }

    return safeApplication(updated);
  }

  /** Right of the previous stage in DEFAULT_PIPELINE order = forward move. */
  private isForwardMove(from: ApplicationStatus, to: ApplicationStatus) {
    const order = DEFAULT_PIPELINE as readonly string[];
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return false;
    return toIdx > fromIdx;
  }

  /** Stage-specific candidate email, written in the candidate's own language. */
  private stageEmail(
    jobTitle: string,
    status: ApplicationStatus,
    note: string | undefined,
    locale: MessageLocale,
  ) {
    const webUrl = process.env.WEB_URL ?? 'https://staging.jobtalent.io';
    const t = (key: string, params?: Record<string, string | number>) =>
      translateMessage(key, locale, params);

    const introKey = `email.applicationStatus.${status}`;
    const intro = isMessageKey(introKey)
      ? t(introKey)
      : t('email.applicationStatus.generic', { status });
    const safeJobTitle = escapeHtml(jobTitle);
    const safeNote = note ? escapeHtml(note) : undefined;
    const safeDashboardUrl = escapeHtml(`${webUrl}/${locale}/dashboard/employee?tab=applications`);

    return {
      subject: t('email.applicationStatus.subject', { job: jobTitle }),
      html: `<p>${t('email.greetingShort')}</p><p>${intro}</p><p>${t(
        'email.applicationStatus.position',
        { job: safeJobTitle },
      )}</p>${safeNote ? `<p>${t('email.applicationStatus.note', { note: safeNote })}</p>` : ''}<p><a href="${safeDashboardUrl}">${t(
        'email.applicationStatus.cta',
      )}</a></p>
       <p style="color:#64748b;font-size:12px">${t('email.footer')}</p>`,
    };
  }

  async rescore(user: AuthUser, applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobPost: true },
    });
    if (!application) throw new NotFoundException();
    await this.companies.assertMember(user, application.jobPost.companyId);

    const breakdown = await this.matching.scoreProfileAgainstJob(
      application.profileId,
      application.jobPostId,
    );
    return safeApplication(await this.prisma.application.update({
      where: { id: applicationId },
      data: { matchScore: breakdown.total, matchBreakdown: breakdown },
    }));
  }

  async scheduleInterview(user: AuthUser, applicationId: string, data: { scheduledAt: string; durationMins?: number; location?: string; meetingUrl?: string; note?: string }, key?: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId }, include: { jobPost: true } });
    if (!application) throw new NotFoundException();
    await this.companies.assertMember(user, application.jobPost.companyId);
    if (!this.operations) return this.scheduleInterviewInside(user, applicationId, data);
    return this.operations.external('interview:' + applicationId, key, { actorId: user.id, data }, () => this.scheduleInterviewInside(user, applicationId, data));
  }
  private async scheduleInterviewInside(
    user: AuthUser,
    applicationId: string,
    data: {
      scheduledAt: string;
      durationMins?: number;
      location?: string;
      meetingUrl?: string;
      note?: string;
    },
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        jobPost: true,
        profile: { include: { user: true } },
      },
    });
    if (!application) throw new NotFoundException();
    await this.companies.assertMember(user, application.jobPost.companyId, [
      'OWNER',
      'ADMIN',
      'RECRUITER',
    ]);

    const interview = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUnique({
        where: { id: applicationId },
        select: { status: true, kanbanEnteredAt:true },
      });
      if (!current) throw new NotFoundException('Application not found');

      if (['WITHDRAWN', 'HIRED', 'REJECTED'].includes(current.status)) {
        throw new BadRequestException('Cannot schedule an interview for a finalized application');
      }
      const claimed = await tx.application.updateMany({
        where: { id: applicationId, status: current.status },
        data: { status: 'INTERVIEW', kanbanEnteredAt:current.kanbanEnteredAt ?? new Date() },
      });
      if (!claimed.count) throw new ConflictException('Application status changed. Refresh and try again.');

      const created = await tx.interview.create({
        data: {
          applicationId,
          scheduledAt: new Date(data.scheduledAt),
          durationMins: data.durationMins ?? 60,
          location: data.location,
          meetingUrl: data.meetingUrl || null,
          note: data.note,
        },
      });

      if (current.status !== 'INTERVIEW') {
        await tx.pipelineEvent.create({ data: {
          applicationId, fromStatus: current.status, toStatus: 'INTERVIEW',
          note: 'Interview scheduled', actorUserId: user.id,
        } });
      }
      return created;
    });

    try {
      await this.notifications.create({
        userId: application.profile.userId,
        type: 'INTERVIEW_SCHEDULED',
        title: `Interview scheduled: ${application.jobPost.title}`,
        body: `On ${new Date(data.scheduledAt).toLocaleString()}`,
        titleKey: 'notify.interviewScheduled.title',
        bodyKey: 'notify.interviewScheduled.body',
        params: {
          job: application.jobPost.title,
          date: new Date(data.scheduledAt).toISOString(),
        },
        linkUrl: `/dashboard/employee?tab=applications`,
      });
    } catch (err) {
      this.logger.warn(`Interview notification failed: ${(err as Error).message}`);
    }

    return interview;
  }

  async listInterviews(user: AuthUser, applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobPost: true, profile: true },
    });
    if (!application) throw new NotFoundException();
    const isOwner = application.profile.userId === user.id;
    if (!isOwner) {
      await this.companies.assertMember(user, application.jobPost.companyId);
    }
    return this.prisma.interview.findMany({
      where: { applicationId },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  /** Download the CV submitted with an application; live fallback for legacy rows only. */
  async downloadResume(user: AuthUser, applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        jobPost: { select: { companyId: true, title: true } },
        profile: { select: { userId: true } },
        resume: true,
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    const isOwner = application.profile.userId === user.id;
    if (!isOwner && user.role !== 'SUPER_ADMIN') {
      await this.companies.assertMember(user, application.jobPost.companyId);
    }

    // The submitted file is immutable evidence of the application. Replacing
    // the library CV must not disclose the replacement to an earlier employer.
    const submitted = submittedResume(application.resumeSnapshot);
    const fileKey = submitted.fileKey;
    const title = submitted.title ?? 'Resume';
    if (!fileKey) throw new NotFoundException('No resume file available for this application');
    try { await this.storage.assertObjectAvailable(fileKey); }
    catch(reason) {
      const error=reason as {name?:string;$metadata?:{httpStatusCode?:number}};
      if(error.name==='NotFound'||error.name==='NoSuchKey'||error.$metadata?.httpStatusCode===404)throw new NotFoundException('Submitted CV file unavailable');
      throw new ServiceUnavailableException('CV storage is temporarily unavailable. Try again.');
    }
    const url = await this.storage.getPresignedGetUrl(fileKey, 900);
    return { url, expiresIn: 900, title };
  }
}
