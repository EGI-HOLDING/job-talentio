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
import { DEFAULT_PIPELINE, KANBAN_STAGES, isMessageKey, translateMessage } from '@job-talentio/shared';
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
import { ANONYMOUS_REVEAL_STATUSES, maskAnonymousCompany, revealsAnonymousEmployer } from '../common/anonymous-job';
import { ApplicantFilters, applicantFilter } from './applicant-filter';
import { canAddToKanban, safeApplication, submittedResume } from './application-payload';
import { LiveUpdates } from '../common/live-updates';
import { jobChatPeers } from '../chat/job-chat-peer';
import { validateOfferFiles, type OfferUploadFile, type ValidatedOfferFile } from './application-offer-files';

function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return error.code === 'P2034' || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)));
}
type ApplicationWindow = { ids:string[]; scores:Map<string,RecruiterBreakdown>;total:number;page:number;totalPages:number };

function safeOfferPacket<T extends {
  kind?: string;
  status?: string;
  createdById?: string | null;
  documents?: Array<{ storageKey: string; uploadedById: string | null }>;
}>(packet: T) {
  const { documents, createdById: _createdById, ...safe } = packet;
  const emptyInformalOffer = packet.kind === 'OFFER' && packet.status === 'PENDING' && documents !== undefined && documents.length === 0;
  return {
    ...safe,
    ...(emptyInformalOffer ? { status: 'SHARED' } : {}),
    requiresCandidateDecision: packet.kind === 'OFFER' && packet.status === 'PENDING' && Boolean(documents?.length),
    ...(documents ? { documents: documents.map(({ storageKey: _storageKey, uploadedById: _uploadedById, ...document }) => document) } : {}),
  };
}

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
    @Optional() private live?: LiveUpdates,
  ) {}

  private async publishChange(companyId: string, candidateId?: string) {
    if (!this.live) return;
    try {
      const members = await this.prisma.companyMember.findMany({where:{companyId},select:{userId:true}});
      this.live.publish([...(candidateId ? [candidateId] : []), ...members.map(member => member.userId)], 'applications');
    } catch (error) { this.logger.warn('Application refresh hint failed: ' + (error as Error).message); }
  }

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

      // Applying fulfills the purpose of a saved-job bookmark. Keep this in the
      // same transaction so a failed application never removes the bookmark.
      await tx.savedJob.deleteMany({ where: { profileId: profile.id, jobPostId } });

        await this.hrEvents?.submitted(tx, application, funnelSession);
        return { application, job, breakdown };
      });
      await this.publishChange(job.companyId, user.id);
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
        resumeSnapshot: true,
        resume: { select: { title: true, fileKey: true } },
      },
    });

    if (!application) return { applied: false as const, application: null };
    const { resumeSnapshot, resume, ...publicApplication } = application;
    const submitted = submittedResume(resumeSnapshot, resume);

    return {
      applied: true as const,
      application: {
        ...publicApplication,
        resumeTitle: submitted.title,
        hasResumeFile: Boolean(submitted.fileKey),
      },
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
        _count: {select:{events:{where:{toStatus:{in:[...ANONYMOUS_REVEAL_STATUSES]}}}}},
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Continue the actual submitted-job conversation, even when a team recruiter
    // (rather than the owner) is handling the candidate. Ignore empty threads.
    const peers = await jobChatPeers(this.prisma,user.id,rows.map(app => ({id:app.jobPostId,companyId:app.jobPost.companyId})));
    // Expose a single chat peer — do not return the members array to clients
    return rows.map((app) => {
      const members = app.jobPost.company.members ?? [];
      const handlingId = peers.get(app.jobPostId);
      const peer = members.find((m) => m.role === 'OWNER') ?? members[0];
      const { members: _members, ...company } = app.jobPost.company;
      // Confidential posting: the employer (and its chat) stays hidden until interview stage.
      const reveal = !app.jobPost.isAnonymous || revealsAnonymousEmployer(app.status) || app._count.events > 0;
      const jobPost = maskAnonymousCompany(
        { ...app.jobPost, company: { ...company, chatPeerUserId: reveal ? handlingId || peer?.userId || null : null } },
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

    const pendingOffers = window.ids.length ? await this.prisma.applicationOfferPacket.findMany({
      where: { applicationId: { in: window.ids }, kind: 'OFFER', status: 'PENDING' },
      select: { applicationId: true, _count: { select: { documents: true } } },
    }) : [];
    const decisionRequired = new Set(pendingOffers.filter(packet => packet._count.documents > 0).map(packet => packet.applicationId));

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
        candidateDecisionRequired: row.status === 'OFFER' && decisionRequired.has(row.id),
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

  private async offerApplicationForAccess(user: AuthUser, applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        status: true,
        jobPostId: true,
        profile: { select: { userId: true, user: { select: { id: true, fullName: true, email: true, emailVerified: true, locale: true } } } },
        jobPost: { select: { id: true, title: true, companyId: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.profile.userId !== user.id && user.role !== 'SUPER_ADMIN') {
      await this.companies.assertMember(user, application.jobPost.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    }
    return application;
  }

  private async assertOfferCompanyAccess(tx: Prisma.TransactionClient, user: AuthUser, companyId: string) {
    const company = await tx.company.findUnique({ where: { id: companyId }, select: { isBanned: true, anonymizedAt: true } });
    if (!company || company.isBanned || company.anonymizedAt) throw new ForbiddenException('Company unavailable');
    if (user.role === 'SUPER_ADMIN') return;
    const membership = await tx.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId: user.id } },
      select: { role: true },
    });
    if (!membership || !['OWNER', 'ADMIN', 'RECRUITER'].includes(membership.role)) {
      throw new ForbiddenException('Company membership changed. Refresh and try again.');
    }
  }

  async listOfferPackets(user: AuthUser, applicationId: string) {
    await this.offerApplicationForAccess(user, applicationId);
    const packets = await this.prisma.applicationOfferPacket.findMany({
      where: { applicationId },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ version: 'desc' }],
    });
    return { packets: packets.map(safeOfferPacket) };
  }

  async downloadOfferDocument(user: AuthUser, applicationId: string, packetId: string, documentId: string) {
    await this.offerApplicationForAccess(user, applicationId);
    const document = await this.prisma.applicationOfferDocument.findFirst({
      where: { id: documentId, packetId, packet: { applicationId } },
    });
    if (!document) throw new NotFoundException('Offer document not found');
    try {
      await this.storage.assertObjectAvailable(document.storageKey);
    } catch (reason) {
      const error = reason as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NotFound' || error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException('Offer document unavailable');
      }
      throw new ServiceUnavailableException('Document storage is temporarily unavailable. Try again.');
    }
    const url = await this.storage.getPresignedGetUrl(document.storageKey, 900, {
      filename: document.originalName,
      contentType: document.contentType,
    });
    return { url, expiresIn: 900, filename: document.originalName, contentType: document.contentType, sizeBytes: document.sizeBytes };
  }

  private async uploadOfferFiles(applicationId: string, userId: string, validated: ValidatedOfferFile[]) {
    const uploaded: Array<{ storageKey: string; originalName: string; contentType: string; sizeBytes: number }> = [];
    try {
      for (const file of validated) {
        const saved = await this.storage.upload(
          file.buffer,
          file.originalName,
          file.contentType,
          `application-offers/${applicationId}`,
        );
        uploaded.push({
          storageKey: saved.key,
          originalName: file.originalName,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        });
      }
      return uploaded.map((file) => ({ ...file, uploadedById: userId }));
    } catch (error) {
      await Promise.all(uploaded.map((file) => this.storage.delete(file.storageKey)));
      throw error;
    }
  }

  private async removeUploadedOfferFiles(files: Array<{ storageKey: string }>) {
    await Promise.all(files.map((file) => this.storage.delete(file.storageKey)));
  }

  async createOffer(user: AuthUser, applicationId: string, files: OfferUploadFile[]) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Employer access required');
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobPost: true, profile: { include: { user: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    const { company } = await this.companies.assertMember(user, application.jobPost.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    if (company.isBanned || company.anonymizedAt) throw new ForbiddenException('Company unavailable');
    const validated = validateOfferFiles(files);
    if (application.status === 'HIRED' || application.status === 'WITHDRAWN') {
      throw new ConflictException('This application cannot receive a new offer');
    }
    if (application.status === 'OFFER') {
      const pending = await this.prisma.applicationOfferPacket.findFirst({
        where: { applicationId, kind: 'OFFER', status: 'PENDING' },
        include: { documents: { select: { id: true } } },
        orderBy: { version: 'desc' },
      });
      if (pending?.documents.length) throw new ConflictException('An offer with documents is already waiting for the candidate');
    }

    const uploaded = await this.uploadOfferFiles(applicationId, user.id, validated);
    let result: { packet: { id: string; version: number; createdById?: string | null; documents?: Array<{ storageKey: string; uploadedById: string | null }> }; application: unknown; changed: boolean };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.assertOfferCompanyAccess(tx, user, application.jobPost.companyId);
        await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
        const current = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
        if (current.status === 'HIRED' || current.status === 'WITHDRAWN') throw new ConflictException('This application cannot receive a new offer');
        const existing = await tx.applicationOfferPacket.findFirst({
          where: { applicationId, kind: 'OFFER', status: 'PENDING' },
          include: { documents: { select: { id: true } } },
          orderBy: { version: 'desc' },
        });
        if (current.status === 'OFFER' && existing?.documents.length) throw new ConflictException('An offer with documents is already waiting for the candidate');
        if (existing && existing.documents.length === 0) {
          await tx.applicationOfferPacket.update({ where: { id: existing.id }, data: { status: 'SHARED' } });
        }
        const latest = await tx.applicationOfferPacket.aggregate({ where: { applicationId, kind: 'OFFER' }, _max: { version: true } });
        const changed = current.status !== 'OFFER';
        const packet = await tx.applicationOfferPacket.create({
          data: {
            applicationId,
            version: (latest._max.version ?? 0) + 1,
            kind: 'OFFER',
            status: uploaded.length ? 'PENDING' : 'SHARED',
            createdById: user.id,
            documents: { create: uploaded },
          },
          include: { documents: true },
        });
        const updated = changed
          ? await tx.application.update({
              where: { id: applicationId },
              data: { status: 'OFFER', ...(!current.kanbanEnteredAt ? { kanbanEnteredAt: new Date() } : {}) },
              include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
            })
          : current;
        if (changed) {
          await tx.pipelineEvent.create({ data: { applicationId, fromStatus: current.status, toStatus: 'OFFER', actorUserId: user.id } });
        }
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'APPLICATION_OFFER_SENT',
            entityType: 'ApplicationOfferPacket',
            entityId: packet.id,
            metadata: { applicationId, companyId: application.jobPost.companyId, version: packet.version, documentCount: uploaded.length },
          },
        });
        return { packet, application: updated, changed };
      });
    } catch (error) {
      await this.removeUploadedOfferFiles(uploaded);
      throw error;
    }

    await this.publishChange(application.jobPost.companyId, application.profile.userId);
    if (result.changed || result.packet.id) {
      try {
        await this.notifications.create({
          userId: application.profile.userId,
          type: 'APPLICATION_STATUS',
          title: `Job offer: ${application.jobPost.title}`,
          body: uploaded.length ? 'A job offer with documents is ready for your review.' : 'The employer will discuss the offer with you outside the app.',
          titleKey: 'notify.applicationOffer.received.title',
          bodyKey: uploaded.length ? 'notify.applicationOffer.received.body' : 'notify.applicationOffer.external.body',
          params: { job: application.jobPost.title },
          linkUrl: '/dashboard/employee?tab=applications',
        });
      } catch (error) { this.logger.warn(`Offer notification failed: ${(error as Error).message}`); }
      if (application.profile.user.emailVerified && application.profile.user.email) {
        const { subject, html } = this.stageEmail(application.jobPost.title, 'OFFER', undefined, emailLocale(application.profile.user.locale));
        void this.mail.send(application.profile.user.email, subject, html);
      }
    }
    return { application: safeApplication(result.application as object), packet: safeOfferPacket(result.packet) };
  }

  async createPostHireDocuments(user: AuthUser, applicationId: string, files: OfferUploadFile[]) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Employer access required');
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobPost: true, profile: { include: { user: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    const { company } = await this.companies.assertMember(user, application.jobPost.companyId, ['OWNER', 'ADMIN', 'RECRUITER']);
    if (company.isBanned || company.anonymizedAt) throw new ForbiddenException('Company unavailable');
    if (application.status !== 'HIRED') throw new ConflictException('Hiring documents can only be shared after the candidate is hired');
    const validated = validateOfferFiles(files);
    if (!validated.length) throw new BadRequestException('Choose at least one document');
    const uploaded = await this.uploadOfferFiles(applicationId, user.id, validated);
    let packet: Awaited<ReturnType<typeof this.prisma.applicationOfferPacket.create>>;
    try {
      packet = await this.prisma.$transaction(async (tx) => {
        await this.assertOfferCompanyAccess(tx, user, application.jobPost.companyId);
        await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
        const current = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
        if (current.status !== 'HIRED') throw new ConflictException('Hiring documents can only be shared after the candidate is hired');
        const latest = await tx.applicationOfferPacket.aggregate({ where: { applicationId, kind: 'POST_HIRE' }, _max: { version: true } });
        const created = await tx.applicationOfferPacket.create({
          data: {
            applicationId,
            version: (latest._max.version ?? 0) + 1,
            kind: 'POST_HIRE',
            status: 'SHARED',
            createdById: user.id,
            documents: { create: uploaded },
          },
          include: { documents: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: user.id,
            action: 'APPLICATION_HIRING_DOCUMENTS_SHARED',
            entityType: 'ApplicationOfferPacket',
            entityId: created.id,
            metadata: { applicationId, companyId: application.jobPost.companyId, version: created.version, documentCount: uploaded.length },
          },
        });
        return created;
      });
    } catch (error) {
      await this.removeUploadedOfferFiles(uploaded);
      throw error;
    }
    await this.publishChange(application.jobPost.companyId, application.profile.userId);
    try {
      await this.notifications.create({
        userId: application.profile.userId,
        type: 'APPLICATION_STATUS',
        title: `Documents from ${application.jobPost.title}`,
        body: 'New hiring documents are available to download.',
        titleKey: 'notify.applicationOffer.documents.title',
        bodyKey: 'notify.applicationOffer.documents.body',
        params: { job: application.jobPost.title },
        linkUrl: '/dashboard/employee?tab=applications',
      });
    } catch (error) { this.logger.warn(`Hiring document notification failed: ${(error as Error).message}`); }
    return safeOfferPacket(packet);
  }

  async decideOffer(user: AuthUser, applicationId: string, decision: 'ACCEPT' | 'DECLINE') {
    if (user.role !== 'EMPLOYEE') throw new ForbiddenException('Employee access required');
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { jobPost: true, profile: { include: { user: true } } },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.profile.userId !== user.id) throw new ForbiddenException('Only the applicant can decide this offer');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUniqueOrThrow({ where: { id: applicationId } });
      const active = await tx.applicationOfferPacket.findFirst({
        where: { applicationId, kind: 'OFFER', status: 'PENDING' },
        include: { documents: true },
        orderBy: { version: 'desc' },
      });
      const targetStatus = decision === 'ACCEPT' ? 'HIRED' : 'WITHDRAWN';
      const targetPacketStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
      if (current.status === targetStatus && active === null) {
        const latest = await tx.applicationOfferPacket.findFirst({ where: { applicationId, kind: 'OFFER' }, include: { documents: true }, orderBy: { version: 'desc' } });
        if (latest?.status === targetPacketStatus) return { application: current, packet: latest, changed: false };
      }
      if (current.status !== 'OFFER' || !active || active.documents.length === 0) {
        throw new ConflictException('This offer has no in-app decision or is no longer awaiting a decision');
      }
      await tx.application.update({ where: { id: applicationId }, data: { status: targetStatus } });
      const packet = await tx.applicationOfferPacket.update({
        where: { id: active.id },
        data: { status: targetPacketStatus, respondedAt: now },
        include: { documents: true },
      });
      await tx.pipelineEvent.create({
        data: {
          applicationId,
          fromStatus: 'OFFER',
          toStatus: targetStatus,
          actorUserId: user.id,
          note: decision === 'ACCEPT' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
        },
      });
      await tx.interview.updateMany({ where: { applicationId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: decision === 'ACCEPT' ? 'APPLICATION_OFFER_ACCEPTED' : 'APPLICATION_OFFER_DECLINED',
          entityType: 'ApplicationOfferPacket',
          entityId: active.id,
          metadata: { applicationId, companyId: application.jobPost.companyId, version: active.version },
        },
      });
      return { application: { ...current, status: targetStatus }, packet, changed: true };
    });

    if (result.changed) {
      await this.publishChange(application.jobPost.companyId, application.profile.userId);
      const members = await this.prisma.companyMember.findMany({ where: { companyId: application.jobPost.companyId }, select: { userId: true } });
      const accepted = decision === 'ACCEPT';
      for (const member of members) {
        try {
          await this.notifications.create({
            userId: member.userId,
            type: 'APPLICATION_STATUS',
            title: `${accepted ? 'Offer accepted' : 'Offer declined'}: ${application.jobPost.title}`,
            body: accepted ? 'The candidate accepted the offer.' : 'The candidate declined the offer.',
            titleKey: 'notify.applicationOffer.decision.title',
            bodyKey: accepted ? 'notify.applicationOffer.accepted.body' : 'notify.applicationOffer.declined.body',
            params: { job: application.jobPost.title },
            linkUrl: `/dashboard/recruiter/jobs/${application.jobPost.id}?section=applicants&company=${application.jobPost.companyId}&application=${application.id}`,
          });
        } catch (error) { this.logger.warn(`Offer decision notification failed: ${(error as Error).message}`); }
      }
    }
    return { application: safeApplication(result.application), packet: safeOfferPacket(result.packet), changed: result.changed };
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
    if (input.status === 'NEW') {
      const job = await this.prisma.jobPost.findUnique({where:{id:jobPostId},select:{companyId:true}});
      if (!job) throw new NotFoundException('Job not found');
      await this.companies.assertMember(user,job.companyId);
      throw new BadRequestException('New applications must enter review before appearing in Kanban');
    }
    const stages = input.status ? [input.status] : [...KANBAN_STAGES];
    const columns = await Promise.all(stages.map(async status => {
      const result = await this.searchForJob(user, jobPostId, {...input, status, sort:'newest', kanbanOnly:true}, locale);
      return {status, ...result, hasMore:result.page < result.totalPages};
    }));
    return {columns};
  }

  async addToKanban(user: AuthUser, applicationId: string) {
    if (user.isBanned || !['RECRUITER','SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException('Employer access required');
    const application = await this.prisma.application.findUnique({
      where:{id:applicationId},
      include:{
        jobPost:true,
        profile:{select:{userId:true,user:{select:{id:true,email:true,emailVerified:true,locale:true}}}},
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    const {company} = await this.companies.assertMember(user,application.jobPost.companyId,['OWNER','ADMIN','RECRUITER']);
    if (company.isBanned || company.anonymizedAt) throw new ForbiddenException('Company unavailable');
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUniqueOrThrow({where:{id:applicationId}});
      if (current.kanbanEnteredAt) return {application:{...safeApplication(current),canAddToKanban:false},movedToReview:false};
      if (!canAddToKanban(current)) throw new ConflictException('A finalized application cannot enter Kanban');
      const movedToReview = current.status === 'NEW';
      const updated = await tx.application.update({
        where:{id:applicationId},
        data:{kanbanEnteredAt:new Date(),...(movedToReview?{status:'IN_REVIEW' as const}:{})},
      });
      if (movedToReview) {
        await tx.pipelineEvent.create({data:{applicationId,fromStatus:'NEW',toStatus:'IN_REVIEW',actorUserId:user.id}});
      }
      await tx.auditLog.create({data:{
        actorId:user.id,
        action:'APPLICATION_KANBAN_ADDED',
        entityType:'Application',
        entityId:applicationId,
        metadata:{companyId:application.jobPost.companyId,jobPostId:application.jobPostId,fromStatus:current.status,toStatus:updated.status},
      }});
      return {application:{...safeApplication(updated),canAddToKanban:false},movedToReview};
    });
    await this.publishChange(application.jobPost.companyId,result.movedToReview?application.profile.userId:undefined);
    if (result.movedToReview) {
      try {
        await this.notifications.create({
          userId:application.profile.user.id,
          type:'APPLICATION_STATUS',
          title:`Application update: ${application.jobPost.title}`,
          body:'Status is now IN_REVIEW',
          titleKey:'notify.applicationStatus.title',
          bodyKey:'notify.applicationStatus.body',
          params:{job:application.jobPost.title,status:'IN_REVIEW'},
          linkUrl:'/dashboard/employee?tab=applications',
        });
      } catch (err) {
        this.logger.warn(`Application status notification failed: ${(err as Error).message}`);
      }
      if (application.profile.user.emailVerified && application.profile.user.email) {
        const {subject,html}=this.stageEmail(application.jobPost.title,'IN_REVIEW',undefined,emailLocale(application.profile.user.locale));
        void this.mail.send(application.profile.user.email,subject,html);
      }
    }
    return result.application;
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
    if (status === 'OFFER') {
      throw new BadRequestException('Offers must be sent through the offer workflow');
    }
    if (!isOwnerCandidate) {
      await this.companies.assertMember(user, application.jobPost.companyId, [
        'OWNER',
        'ADMIN',
        'RECRUITER',
      ]);
    }
    if (!isOwnerCandidate && status === 'NEW') {
      throw new BadRequestException('A processed application cannot return to NEW');
    }

    if (isOwnerCandidate && ['HIRED', 'REJECTED'].includes(application.status)) {
      throw new BadRequestException('A finalized application cannot be withdrawn');
    }
    if (application.status === 'HIRED' && status !== 'HIRED') {
      throw new ConflictException('A hired application is final. Use the audited Super Admin correction action if needed.');
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

    const transition = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Application" WHERE id=${applicationId} FOR UPDATE`;
      const current = await tx.application.findUniqueOrThrow({where:{id:applicationId}});
      if (current.status !== application.status) throw new ConflictException('Application status changed. Refresh and try again.');
      if (current.status === 'HIRED' && status !== 'HIRED') {
        throw new ConflictException('A hired application is final. Use the audited Super Admin correction action if needed.');
      }
      if (current.status === 'WITHDRAWN' && status !== 'WITHDRAWN') {
        throw new BadRequestException('A withdrawn application cannot be reopened');
      }
      let offerDecision = false;
      if (current.status === 'OFFER') {
        const activeOffer = await tx.applicationOfferPacket.findFirst({
          where: { applicationId, kind: 'OFFER', status: 'PENDING' },
          include: { documents: { select: { id: true } } },
          orderBy: { version: 'desc' },
        });
        if (activeOffer) {
          const hasDocuments = activeOffer.documents.length > 0;
          if (hasDocuments && !isOwnerCandidate) {
            throw new ConflictException('The candidate must respond to the documented offer before HR can change the application stage');
          }
          offerDecision = hasDocuments && isOwnerCandidate && status === 'WITHDRAWN';
          await tx.applicationOfferPacket.update({
            where: { id: activeOffer.id },
            data: {
              status: hasDocuments ? (offerDecision ? 'DECLINED' : 'REVOKED') : 'SHARED',
              ...(offerDecision ? { respondedAt: new Date() } : hasDocuments ? { revokedAt: new Date() } : {}),
            },
          });
          if (offerDecision) {
            await tx.auditLog.create({
              data: {
                actorId: user.id,
                action: 'APPLICATION_OFFER_DECLINED',
                entityType: 'ApplicationOfferPacket',
                entityId: activeOffer.id,
                metadata: { applicationId, companyId: application.jobPost.companyId, targetStatus: status },
              },
            });
          }
          if (hasDocuments && !offerDecision) {
            await tx.auditLog.create({
              data: {
                actorId: user.id,
                action: 'APPLICATION_OFFER_REVOKED',
                entityType: 'ApplicationOfferPacket',
                entityId: activeOffer.id,
                metadata: { applicationId, companyId: application.jobPost.companyId, targetStatus: status },
              },
            });
          }
        }
      }
      const claimed = await tx.application.updateMany({
        where: { id: applicationId, status: current.status },
        data: { status, ...(!isOwnerCandidate && !current.kanbanEnteredAt ? {kanbanEnteredAt:new Date()} : {}) },
      });
      if (!claimed.count) throw new ConflictException('Application status changed. Refresh and try again.');
      await tx.pipelineEvent.create({ data: {
        applicationId, fromStatus: current.status, toStatus: status,
        note: offerDecision ? 'OFFER_DECLINED' : note,
        actorUserId: user.id,
      } });
      // An interview invitation must not remain actionable after leaving that stage.
      if (status !== 'INTERVIEW') {
        await tx.interview.updateMany({where:{applicationId,status:'SCHEDULED'},data:{status:'CANCELLED'}});
      }
      const updated = await tx.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
      });
      return { application: updated, offerDecision };
    });

    await this.publishChange(application.jobPost.companyId, application.profile.userId);
    if (transition.offerDecision) {
      const members = await this.prisma.companyMember.findMany({ where: { companyId: application.jobPost.companyId }, select: { userId: true } });
      for (const member of members) {
        try {
          await this.notifications.create({
            userId: member.userId,
            type: 'APPLICATION_STATUS',
            title: `Offer declined: ${application.jobPost.title}`,
            body: 'The candidate declined the offer.',
            titleKey: 'notify.applicationOffer.decision.title',
            bodyKey: 'notify.applicationOffer.declined.body',
            params: { job: application.jobPost.title },
            linkUrl: `/dashboard/recruiter/jobs/${application.jobPost.id}?section=applicants&company=${application.jobPost.companyId}&application=${application.id}`,
          });
        } catch (err) { this.logger.warn(`Offer decline notification failed: ${(err as Error).message}`); }
      }
    }
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

    return safeApplication(transition.application);
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
    if (!Number.isFinite(Date.parse(data.scheduledAt)) || Date.parse(data.scheduledAt) <= Date.now()) {
      throw new BadRequestException('Interview time must be in the future');
    }
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
        select: { status: true },
      });
      if (!current) throw new NotFoundException('Application not found');

      if (current.status !== 'INTERVIEW') {
        throw new BadRequestException('Application must be in the INTERVIEW stage before scheduling');
      }

      return tx.interview.create({
        data: {
          applicationId,
          scheduledAt: new Date(data.scheduledAt),
          durationMins: data.durationMins ?? 60,
          location: data.location,
          meetingUrl: data.meetingUrl || null,
          note: data.note,
        },
      });
    });

    await this.publishChange(application.jobPost.companyId, application.profile.userId);
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
