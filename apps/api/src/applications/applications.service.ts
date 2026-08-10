import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { DEFAULT_PIPELINE } from '@job-talentio/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private companies: CompaniesService,
    private matching: MatchingService,
    private notifications: NotificationsService,
    private mail: MailService,
  ) {}

  async apply(
    user: AuthUser,
    jobPostId: string,
    coverLetter?: string,
    answers?: Array<{ questionId: string; answer: string }>,
    resumeId?: string,
  ) {
    if (user.role !== 'EMPLOYEE' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only employees can apply');
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId: user.id },
      include: {
        skills: { include: { skill: true } },
        experiences: true,
        educations: true,
        resumes: { where: { deletedAt: null } },
      },
    });
    if (!profile) throw new BadRequestException('Complete your employee profile first');

    const job = await this.prisma.jobPost.findUnique({
      where: { id: jobPostId },
      include: {
        questions: true,
        company: { include: { members: { where: { role: { in: ['OWNER', 'ADMIN'] } }, take: 5 } } },
      },
    });
    if (!job || job.status !== 'PUBLISHED') {
      throw new NotFoundException('Job not available');
    }

    // Pre-check: one application per employee per job (also enforced by @@unique)
    const existing = await this.prisma.application.findUnique({
      where: { jobPostId_profileId: { jobPostId, profileId: profile.id } },
      select: { id: true, status: true, createdAt: true },
    });
    if (existing) {
      throw new ConflictException(
        `You have already applied to this job (status: ${existing.status}).`,
      );
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

    const breakdown = await this.matching.scoreProfileAgainstJob(profile.id, jobPostId);

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

    try {
      const application = await this.prisma.application.create({
        data: {
          jobPostId,
          profileId: profile.id,
          resumeId: selectedResume?.id ?? null,
          coverLetter,
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

      for (const member of job.company.members) {
        await this.notifications.create({
          userId: member.userId,
          type: 'NEW_APPLICANT',
          title: `New applicant for ${job.title}`,
          body: `${user.fullName} applied (match ${breakdown.total}%)`,
          linkUrl: `/dashboard/recruiter?job=${job.id}`,
        });
      }

      return application;
    } catch (err) {
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

  async myApplications(user: AuthUser) {
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
      return {
        ...app,
        jobPost: {
          ...app.jobPost,
          company: {
            ...company,
            chatPeerUserId: peer?.userId ?? null,
          },
        },
      };
    });
  }

  async listForJob(
    user: AuthUser,
    jobPostId: string,
    opts?: { status?: string; sort?: 'match' | 'newest'; minMatch?: number },
  ) {
    const job = await this.prisma.jobPost.findUnique({ where: { id: jobPostId } });
    if (!job) throw new NotFoundException('Job not found');
    await this.companies.assertMember(user, job.companyId);

    const where: Record<string, unknown> = { jobPostId };
    if (opts?.status) where.status = opts.status;
    if (opts?.minMatch !== undefined) where.matchScore = { gte: opts.minMatch };

    const rows = await this.prisma.application.findMany({
      where,
      include: {
        resume: { select: { id: true, title: true, fileKey: true } },
        profile: {
          include: {
            user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
            skills: { include: { skill: true } },
            city: true,
            experiences: true,
            educations: true,
          },
        },
        events: { orderBy: { createdAt: 'desc' }, take: 10 },
        answers: { include: { question: true } },
        interviews: { orderBy: { scheduledAt: 'asc' } },
      },
      orderBy:
        opts?.sort === 'newest'
          ? [{ createdAt: 'desc' }]
          : [{ matchScore: 'desc' }, { createdAt: 'desc' }],
    });

    return rows.map((row) => {
      const { resume, resumeSnapshot, ...rest } = row;
      const snap = resumeSnapshot as
        | {
            resume?: { title?: string | null; fileKey?: string | null; hasFile?: boolean };
            [key: string]: unknown;
          }
        | null;
      const snapResume = snap?.resume;
      const hasResumeFile = Boolean(resume?.fileKey || snapResume?.fileKey);
      let safeSnapshot: unknown = resumeSnapshot;
      if (snap && snapResume && 'fileKey' in snapResume) {
        const { fileKey: _fileKey, ...resumeWithoutKey } = snapResume;
        safeSnapshot = { ...snap, resume: { ...resumeWithoutKey, hasFile: hasResumeFile } };
      }
      return {
        ...rest,
        resumeSnapshot: safeSnapshot,
        resumeTitle: resume?.title ?? snapResume?.title ?? null,
        hasResumeFile,
      };
    });
  }

  async updateStatus(
    user: AuthUser,
    applicationId: string,
    status: ApplicationStatus,
    note?: string,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        jobPost: true,
        profile: { include: { user: true } },
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

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        status,
        events: {
          create: {
            fromStatus: application.status,
            toStatus: status,
            note,
            actorUserId: user.id,
          },
        },
      },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });

    await this.notifications.create({
      userId: application.profile.userId,
      type: 'APPLICATION_STATUS',
      title: `Application update: ${application.jobPost.title}`,
      body: `Status is now ${status}${note ? `. Note: ${note}` : ''}`,
      linkUrl: `/dashboard/employee`,
    });

    // Email only for recruiter forward (right) moves, and only if the
    // candidate has verified their platform email. Left moves / withdraw = in-app only.
    const shouldEmail =
      !isOwnerCandidate &&
      status !== 'WITHDRAWN' &&
      this.isForwardMove(application.status, status) &&
      Boolean(application.profile.user.emailVerified);

    if (shouldEmail) {
      const { subject, html } = this.stageEmail(
        application.jobPost.title,
        status,
        note,
      );
      void this.mail.send(application.profile.user.email, subject, html);
    }

    return updated;
  }

  /** Right of the previous stage in DEFAULT_PIPELINE order = forward move. */
  private isForwardMove(from: ApplicationStatus, to: ApplicationStatus) {
    const order = DEFAULT_PIPELINE as readonly string[];
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(to);
    if (fromIdx === -1 || toIdx === -1) return false;
    return toIdx > fromIdx;
  }

  /** Stage-specific candidate email for forward pipeline moves. */
  private stageEmail(jobTitle: string, status: ApplicationStatus, note?: string) {
    const webUrl = process.env.WEB_URL ?? 'https://staging.jobtalent.io';
    const messages: Partial<Record<ApplicationStatus, { subject: string; intro: string }>> = {
      IN_REVIEW: {
        subject: `Your application is being reviewed - ${jobTitle}`,
        intro: 'Good news! The recruiter moved your application to In review.',
      },
      INTERVIEW: {
        subject: `Interview stage - ${jobTitle}`,
        intro:
          'Congratulations! You have moved to the Interview stage. The recruiter will share schedule details soon.',
      },
      OFFER: {
        subject: `You received an offer - ${jobTitle}`,
        intro: 'Great news! The company moved you to the Offer stage for this position.',
      },
      HIRED: {
        subject: `Welcome aboard - ${jobTitle}`,
        intro: 'Congratulations! You have been hired for this position.',
      },
      REJECTED: {
        subject: `Application update - ${jobTitle}`,
        intro:
          'Thank you for your interest. The company decided not to move forward with your application this time.',
      },
    };
    const m = messages[status] ?? {
      subject: `Application update - ${jobTitle}`,
      intro: `Your application status is now ${status}.`,
    };
    return {
      subject: m.subject,
      html: `<p>Salom!</p><p>${m.intro}</p><p>Position: <strong>${jobTitle}</strong></p>${
        note ? `<p>Note from recruiter: ${note}</p>` : ''
      }<p><a href="${webUrl}/dashboard/employee">Open your dashboard</a></p>
       <p style="color:#64748b;font-size:12px">Job Talentio · You received this because your email is verified.</p>`,
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
    return this.prisma.application.update({
      where: { id: applicationId },
      data: { matchScore: breakdown.total, matchBreakdown: breakdown },
    });
  }

  async scheduleInterview(
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

    const interview = await this.prisma.interview.create({
      data: {
        applicationId,
        scheduledAt: new Date(data.scheduledAt),
        durationMins: data.durationMins ?? 60,
        location: data.location,
        meetingUrl: data.meetingUrl || null,
        note: data.note,
      },
    });

    if (application.status !== 'INTERVIEW') {
      await this.updateStatus(user, applicationId, 'INTERVIEW', 'Interview scheduled');
    }

    await this.notifications.create({
      userId: application.profile.userId,
      type: 'INTERVIEW_SCHEDULED',
      title: `Interview scheduled: ${application.jobPost.title}`,
      body: `On ${new Date(data.scheduledAt).toLocaleString()}`,
      linkUrl: `/dashboard/employee`,
    });

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

  /** Download CV for an application — live resume file, else snapshot fileKey. */
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

    let fileKey = application.resume?.fileKey ?? null;
    let title = application.resume?.title ?? 'Resume';
    if (!fileKey) {
      const snap = application.resumeSnapshot as
        | { resume?: { fileKey?: string | null; title?: string | null } }
        | null;
      fileKey = snap?.resume?.fileKey ?? null;
      if (snap?.resume?.title) title = snap.resume.title;
    }
    if (!fileKey) throw new NotFoundException('No resume file available for this application');

    const url = await this.storage.getPresignedGetUrl(fileKey, 900);
    return { url, expiresIn: 900, title };
  }
}
