import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/auth.decorators';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private prisma: PrismaService,
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
        resumes: { where: { isPrimary: true }, take: 1 },
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
      resume: profile.resumes[0] ?? null,
      snapshotAt: new Date().toISOString(),
    };

    try {
      const application = await this.prisma.application.create({
        data: {
          jobPostId,
          profileId: profile.id,
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
            create: (answers || []).map((a) => ({
              questionId: a.questionId,
              answer: a.answer,
            })),
          },
        },
        include: {
          jobPost: { include: { company: true } },
          answers: { include: { question: true } },
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
    return this.prisma.application.findMany({
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
                members: { select: { userId: true, role: true }, take: 5 },
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

    return this.prisma.application.findMany({
      where,
      include: {
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

    await this.mail.send(
      application.profile.user.email,
      `Application update: ${application.jobPost.title}`,
      `<p>Your application status is now <strong>${status}</strong>.</p>${
        note ? `<p>Note: ${note}</p>` : ''
      }`,
    );

    return updated;
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
}
