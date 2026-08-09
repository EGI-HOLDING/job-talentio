import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PLAN_LIMITS, normalizeResumeInclusion, scoreResumeChecklist, DEFAULT_RESUME_INCLUSION } from '@job-talentio/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify } from '../common/utils';
import { normalizePhone } from '../common/dedupe';
import { resolveSkill } from '../common/skill-resolve';
import { resolveLanguage } from '../common/language-resolve';
import { resolveCity } from '../common/city-resolve';
import { parseCvText, ParsedCvData } from './cv-parser';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

@Injectable()
export class ProfilesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private companies: CompaniesService,
    private matching: MatchingService,
  ) {}

  private profileInclude = {
    skills: { include: { skill: true } },
    experiences: { include: { city: true } },
    educations: true,
    certifications: true,
    languages: { include: { language: true } },
    resumes: { orderBy: { updatedAt: 'desc' as const } },
    city: true,
    user: {
      select: { id: true, fullName: true, email: true, locale: true, avatarUrl: true },
    },
  };

  private async getProfileForUser(userId: string) {
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      include: this.profileInclude,
    });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  /** Never expose storage object keys to clients. */
  private sanitizeResume<T extends { fileKey?: string | null }>(resume: T) {
    const { fileKey, ...rest } = resume as T & { fileKey?: string | null };
    return { ...rest, hasFile: Boolean(fileKey) };
  }

  private sanitizeProfileResumes<T extends { resumes?: Array<{ fileKey?: string | null }> }>(
    profile: T,
  ): T {
    if (!profile.resumes?.length) return profile;
    return {
      ...profile,
      resumes: profile.resumes.map((r) => this.sanitizeResume(r)),
    };
  }

  async myProfile(user: AuthUser) {
    const profile = await this.getProfileForUser(user.id);
    return this.sanitizeProfileResumes(profile);
  }

  async updateProfile(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    let cityId: string | null | undefined = undefined;
    if (data.citySlug !== undefined) {
      if (!data.citySlug) cityId = null;
      else {
        try {
          const { city } = await resolveCity(this.prisma, {
            slug: String(data.citySlug),
            allowCreate: false,
          });
          cityId = city.id;
        } catch {
          cityId = null;
        }
      }
    }

    let phone: string | null | undefined = undefined;
    if (data.phone !== undefined) {
      const raw = String(data.phone || '').trim();
      if (!raw) phone = null;
      else {
        phone = normalizePhone(raw);
        if (phone.length < 9) throw new BadRequestException('Invalid phone number');
        const taken = await this.prisma.employeeProfile.findFirst({
          where: { phone, NOT: { id: profile.id } },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException('This phone number is already linked to another account');
        }
      }
    }

    try {
      return await this.prisma.employeeProfile.update({
        where: { userId: user.id },
        data: {
          headline: data.headline as string | undefined,
          summary: data.summary as string | undefined,
          cityId,
          phone,
          visibility: data.visibility as never,
          desiredSalaryMin: data.desiredSalaryMin as number | null | undefined,
          desiredPosition: data.desiredPosition as string | undefined,
        },
        include: this.profileInclude,
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('This phone number is already linked to another account');
      }
      throw e;
    }
  }

  async addSkill(user: AuthUser, opts: { slug?: string; name?: string; level?: string }) {
    const profile = await this.getProfileForUser(user.id);
    const { skill, created, matchedVia } = await resolveSkill(this.prisma, {
      slug: opts.slug,
      name: opts.name,
      allowCreate: true,
    });

    const row = await this.prisma.profileSkill.upsert({
      where: { profileId_skillId: { profileId: profile.id, skillId: skill.id } },
      create: {
        profileId: profile.id,
        skillId: skill.id,
        level: (opts.level as never) || 'INTERMEDIATE',
      },
      update: { level: (opts.level as never) || 'INTERMEDIATE' },
      include: { skill: true },
    });
    return { ...row, skillCreated: created, matchedVia };
  }

  async removeSkill(user: AuthUser, skillId: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.profileSkill.deleteMany({
      where: { OR: [{ id: skillId, profileId: profile.id }, { skillId, profileId: profile.id }] },
    });
    if (result.count === 0) throw new NotFoundException('Skill not found');
    return { ok: true };
  }

  async updateSkillLevel(user: AuthUser, id: string, level: string) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.profileSkill.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Skill not found');
    return this.prisma.profileSkill.update({
      where: { id: existing.id },
      data: { level: level as never },
      include: { skill: true },
    });
  }

  async addExperience(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    let cityId: string | null = null;
    if (data.citySlug) {
      const city = await this.prisma.city.findUnique({
        where: { slug: String(data.citySlug) },
      });
      cityId = city?.id ?? null;
    }
    return this.prisma.workExperience.create({
      data: {
        profileId: profile.id,
        companyName: String(data.companyName),
        title: String(data.title),
        description: (data.description as string) || null,
        cityId,
        locationNote: (data.locationNote as string) || null,
        startDate: new Date(String(data.startDate)),
        endDate: data.endDate ? new Date(String(data.endDate)) : null,
        isCurrent: Boolean(data.isCurrent),
      },
      include: { city: true },
    });
  }

  private async resolveExperienceCityId(citySlug?: unknown) {
    if (!citySlug) return undefined;
    const city = await this.prisma.city.findUnique({
      where: { slug: String(citySlug) },
    });
    return city?.id ?? null;
  }

  async updateExperience(user: AuthUser, id: string, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.workExperience.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Experience not found');

    const cityId =
      data.citySlug !== undefined
        ? await this.resolveExperienceCityId(data.citySlug || null)
        : undefined;

    return this.prisma.workExperience.update({
      where: { id },
      data: {
        ...(data.companyName !== undefined ? { companyName: String(data.companyName) } : {}),
        ...(data.title !== undefined ? { title: String(data.title) } : {}),
        ...(data.description !== undefined
          ? { description: (data.description as string) || null }
          : {}),
        ...(cityId !== undefined ? { cityId } : {}),
        ...(data.locationNote !== undefined
          ? { locationNote: (data.locationNote as string) || null }
          : {}),
        ...(data.startDate !== undefined ? { startDate: new Date(String(data.startDate)) } : {}),
        ...(data.endDate !== undefined
          ? { endDate: data.endDate ? new Date(String(data.endDate)) : null }
          : {}),
        ...(data.isCurrent !== undefined ? { isCurrent: Boolean(data.isCurrent) } : {}),
      },
      include: { city: true },
    });
  }

  async removeExperience(user: AuthUser, id: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.workExperience.deleteMany({
      where: { id, profileId: profile.id },
    });
    if (result.count === 0) throw new NotFoundException('Experience not found');
    return { ok: true };
  }

  async addEducation(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    return this.prisma.education.create({
      data: {
        profileId: profile.id,
        school: String(data.school),
        degree: (data.degree as never) || null,
        field: (data.field as string) || null,
        startDate: data.startDate ? new Date(String(data.startDate)) : null,
        endDate: data.endDate ? new Date(String(data.endDate)) : null,
      },
    });
  }

  async updateEducation(user: AuthUser, id: string, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.education.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Education not found');
    return this.prisma.education.update({
      where: { id },
      data: {
        ...(data.school !== undefined ? { school: String(data.school) } : {}),
        ...(data.degree !== undefined ? { degree: (data.degree as never) || null } : {}),
        ...(data.field !== undefined ? { field: (data.field as string) || null } : {}),
        ...(data.startDate !== undefined
          ? { startDate: data.startDate ? new Date(String(data.startDate)) : null }
          : {}),
        ...(data.endDate !== undefined
          ? { endDate: data.endDate ? new Date(String(data.endDate)) : null }
          : {}),
      },
    });
  }

  async removeEducation(user: AuthUser, id: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.education.deleteMany({
      where: { id, profileId: profile.id },
    });
    if (result.count === 0) throw new NotFoundException('Education not found');
    return { ok: true };
  }

  async addCertification(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    return this.prisma.certification.create({
      data: {
        profileId: profile.id,
        name: String(data.name),
        issuer: (data.issuer as string) || null,
        issuedAt: data.issuedAt ? new Date(String(data.issuedAt)) : null,
        expiresAt: data.expiresAt ? new Date(String(data.expiresAt)) : null,
        credentialUrl: (data.credentialUrl as string) || null,
      },
    });
  }

  async updateCertification(user: AuthUser, id: string, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.certification.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Certification not found');
    return this.prisma.certification.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: String(data.name) } : {}),
        ...(data.issuer !== undefined ? { issuer: (data.issuer as string) || null } : {}),
        ...(data.issuedAt !== undefined
          ? { issuedAt: data.issuedAt ? new Date(String(data.issuedAt)) : null }
          : {}),
        ...(data.expiresAt !== undefined
          ? { expiresAt: data.expiresAt ? new Date(String(data.expiresAt)) : null }
          : {}),
        ...(data.credentialUrl !== undefined
          ? { credentialUrl: (data.credentialUrl as string) || null }
          : {}),
      },
    });
  }

  async removeCertification(user: AuthUser, id: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.certification.deleteMany({
      where: { id, profileId: profile.id },
    });
    if (result.count === 0) throw new NotFoundException('Certification not found');
    return { ok: true };
  }

  async addLanguage(user: AuthUser, opts: { code?: string; name?: string; level: string }) {
    const profile = await this.getProfileForUser(user.id);
    const { language, created, matchedVia } = await resolveLanguage(this.prisma, {
      code: opts.code,
      name: opts.name,
      allowCreate: true,
    });

    const row = await this.prisma.profileLanguage.upsert({
      where: {
        profileId_languageId: { profileId: profile.id, languageId: language.id },
      },
      create: {
        profileId: profile.id,
        languageId: language.id,
        level: opts.level as never,
      },
      update: { level: opts.level as never },
      include: { language: true },
    });
    return { ...row, languageCreated: created, matchedVia };
  }

  async updateLanguageLevel(user: AuthUser, id: string, level: string) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.profileLanguage.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Language not found');
    return this.prisma.profileLanguage.update({
      where: { id: existing.id },
      data: { level: level as never },
      include: { language: true },
    });
  }

  async removeLanguage(user: AuthUser, id: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.profileLanguage.deleteMany({
      where: { id, profileId: profile.id },
    });
    if (result.count === 0) throw new NotFoundException('Language not found');
    return { ok: true };
  }

  async createResume(user: AuthUser, data: { title: string; content?: string; isPrimary?: boolean }) {
    const profile = await this.getProfileForUser(user.id);
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: profile.id },
        data: { isPrimary: false },
      });
    }
    return this.prisma.resume.create({
      data: {
        profileId: profile.id,
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary ?? false,
      },
    });
  }

  async updateResume(
    user: AuthUser,
    resumeId: string,
    data: { title?: string; content?: string; isPrimary?: boolean },
  ) {
    const profile = await this.getProfileForUser(user.id);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id },
    });
    if (!resume) throw new NotFoundException();
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: profile.id },
        data: { isPrimary: false },
      });
    }
    return this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary,
      },
    });
  }

  async deleteResume(user: AuthUser, resumeId: string) {
    const profile = await this.getProfileForUser(user.id);
    const result = await this.prisma.resume.deleteMany({
      where: { id: resumeId, profileId: profile.id },
    });
    if (result.count === 0) throw new NotFoundException('Resume not found');
    return { ok: true };
  }

  private filterByIds<T extends { id: string }>(rows: T[], ids: string[] | null | undefined) {
    if (ids == null) return rows;
    const set = new Set(ids);
    return rows.filter((r) => set.has(r.id));
  }

  async getResumeDocument(user: AuthUser, resumeId?: string) {
    const profile = await this.getProfileForUser(user.id);
    const full = await this.prisma.employeeProfile.findUnique({
      where: { id: profile.id },
      include: {
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
        city: true,
        skills: { include: { skill: true } },
        experiences: { include: { city: true }, orderBy: { startDate: 'desc' } },
        educations: { orderBy: { startDate: 'desc' } },
        languages: { include: { language: true } },
        certifications: true,
        resumes: true,
      },
    });
    if (!full) throw new NotFoundException('Profile not found');

    let resume =
      (resumeId
        ? full.resumes.find((r) => r.id === resumeId)
        : full.resumes.find((r) => r.isPrimary) || full.resumes[0]) || null;

    const inclusion = normalizeResumeInclusion(
      (resume?.inclusion as never) || DEFAULT_RESUME_INCLUSION,
    );
    const sections = inclusion.sections;

    const skills = sections.skills
      ? this.filterByIds(full.skills, inclusion.skillIds)
      : [];
    const experiences = sections.experience
      ? this.filterByIds(full.experiences, inclusion.experienceIds)
      : [];
    const educations = sections.education
      ? this.filterByIds(full.educations, inclusion.educationIds)
      : [];
    const languages = sections.languages
      ? this.filterByIds(full.languages, inclusion.languageIds)
      : [];
    const certifications = sections.certifications
      ? this.filterByIds(full.certifications, inclusion.certificationIds)
      : [];

    const document = {
      fullName: full.user.fullName,
      headline: full.headline,
      summary: sections.summary ? full.summary : null,
      email: sections.email ? full.user.email : null,
      phone: sections.phone ? full.phone : null,
      city: full.city?.name ?? null,
      skills: skills.map((s) => ({
        id: s.id,
        name: s.skill.name,
        level: s.level,
      })),
      experiences: experiences.map((e) => ({
        id: e.id,
        title: e.title,
        companyName: e.companyName,
        description: e.description,
        startDate: e.startDate,
        endDate: e.endDate,
        isCurrent: e.isCurrent,
        location: e.city?.name || e.locationNote || null,
      })),
      educations: educations.map((e) => ({
        id: e.id,
        school: e.school,
        degree: e.degree,
        field: e.field,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      languages: languages.map((l) => ({
        id: l.id,
        name: l.language.name,
        level: l.level,
      })),
      certifications: certifications.map((c) => ({
        id: c.id,
        name: c.name,
        issuer: c.issuer,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
      })),
    };

    const checklist = scoreResumeChecklist({
      headline: document.headline,
      summary: document.summary,
      email: document.email,
      phone: document.phone,
      skills: document.skills,
      experiences: document.experiences,
      educations: document.educations,
      languages: document.languages,
      certifications: document.certifications,
    });

    // Source lists for builder checkboxes (unfiltered)
    const source = {
      skills: full.skills.map((s) => ({ id: s.id, name: s.skill.name, level: s.level })),
      experiences: full.experiences.map((e) => ({
        id: e.id,
        title: e.title,
        companyName: e.companyName,
      })),
      educations: full.educations.map((e) => ({ id: e.id, school: e.school })),
      languages: full.languages.map((l) => ({
        id: l.id,
        name: l.language.name,
        level: l.level,
      })),
      certifications: full.certifications.map((c) => ({ id: c.id, name: c.name })),
    };

    return {
      resume: resume
        ? {
            id: resume.id,
            title: resume.title,
            isPrimary: resume.isPrimary,
            templateKey: resume.templateKey || 'classic',
            themeAccent: resume.themeAccent,
            inclusion,
            hasFile: Boolean(resume.fileKey),
          }
        : null,
      document,
      source,
      checklist,
      profile: {
        headline: full.headline,
        summary: full.summary,
        phone: full.phone,
        visibility: full.visibility,
      },
    };
  }

  async createResumeFromBuilder(
    user: AuthUser,
    data: {
      title: string;
      templateKey?: string;
      themeAccent?: string | null;
      inclusion?: unknown;
      isPrimary?: boolean;
    },
  ) {
    const profile = await this.getProfileForUser(user.id);
    if (data.isPrimary !== false) {
      await this.prisma.resume.updateMany({
        where: { profileId: profile.id },
        data: { isPrimary: false },
      });
    }
    const created = await this.prisma.resume.create({
      data: {
        profileId: profile.id,
        title: data.title,
        templateKey: data.templateKey || 'classic',
        themeAccent: data.themeAccent ?? null,
        inclusion: (normalizeResumeInclusion(data.inclusion as never) ||
          DEFAULT_RESUME_INCLUSION) as never,
        isPrimary: data.isPrimary !== false,
      },
    });
    return this.sanitizeResume(created);
  }

  async updateResumeBuilder(
    user: AuthUser,
    resumeId: string,
    data: {
      title?: string;
      templateKey?: string;
      themeAccent?: string | null;
      inclusion?: unknown;
      isPrimary?: boolean;
    },
  ) {
    const { resume } = await this.ownedResume(user.id, resumeId);
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: resume.profileId },
        data: { isPrimary: false },
      });
    }
    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.templateKey !== undefined ? { templateKey: data.templateKey } : {}),
        ...(data.themeAccent !== undefined ? { themeAccent: data.themeAccent } : {}),
        ...(data.inclusion !== undefined
          ? { inclusion: normalizeResumeInclusion(data.inclusion as never) as never }
          : {}),
        ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
      },
    });
    return this.sanitizeResume(updated);
  }

  async exportResumePdf(user: AuthUser, resumeId: string) {
    const payload = await this.getResumeDocument(user, resumeId);
    if (!payload.resume) throw new NotFoundException('Resume not found');
    const { buildResumePdfBuffer } = await import('./resume-pdf');
    const buffer = await buildResumePdfBuffer({
      fullName: payload.document.fullName,
      headline: payload.document.headline,
      email: payload.document.email,
      phone: payload.document.phone,
      city: payload.document.city,
      summary: payload.document.summary,
      templateKey: payload.resume.templateKey,
      themeAccent: payload.resume.themeAccent,
      skills: payload.document.skills.map((s) => s.name),
      experiences: payload.document.experiences.map((e) => ({
        title: e.title,
        companyName: e.companyName,
        startDate: e.startDate ? new Date(e.startDate).toISOString() : null,
        endDate: e.endDate ? new Date(e.endDate).toISOString() : null,
        isCurrent: e.isCurrent,
        description: e.description,
        location: e.location,
      })),
      educations: payload.document.educations.map((e) => ({
        school: e.school,
        degree: e.degree,
        field: e.field,
        startDate: e.startDate ? new Date(e.startDate).toISOString() : null,
        endDate: e.endDate ? new Date(e.endDate).toISOString() : null,
      })),
      languages: payload.document.languages,
      certifications: payload.document.certifications,
    });

    const uploaded = await this.storage.upload(
      buffer,
      `${payload.resume.title || 'resume'}.pdf`,
      'application/pdf',
      'cvs',
    );
    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        fileKey: uploaded.key,
        fileUrl: null,
        builderMeta: {
          lastExportAt: new Date().toISOString(),
          checklistScore: payload.checklist.score,
        } as never,
      },
    });
    const download = await this.storage.getPresignedGetUrl(uploaded.key, 900);
    return {
      ...this.sanitizeResume(updated),
      downloadUrl: download,
      checklist: payload.checklist,
    };
  }

  private async ownedResume(userId: string, resumeId: string) {
    const profile = await this.getProfileForUser(userId);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id },
    });
    if (!resume) throw new NotFoundException('Resume not found');
    return { profile, resume };
  }

  async downloadResume(user: AuthUser, resumeId: string) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      include: { profile: { select: { id: true, userId: true } } },
    });
    if (!resume) throw new NotFoundException('Resume not found');
    if (!resume.fileKey) throw new NotFoundException('No file attached to this resume');

    const isOwner = resume.profile.userId === user.id;
    let allowed = isOwner || user.role === 'SUPER_ADMIN';

    // Recruiter may download only if the candidate applied to their company
    if (!allowed && user.role === 'RECRUITER') {
      const companyIds = (user.memberships ?? []).map((m) => m.companyId).filter(Boolean);
      if (companyIds.length) {
        const applied = await this.prisma.application.findFirst({
          where: {
            profileId: resume.profile.id,
            jobPost: { companyId: { in: companyIds } },
          },
          select: { id: true },
        });
        allowed = Boolean(applied);
      }
    }

    if (!allowed) throw new ForbiddenException('Not allowed to download this resume');

    const url = await this.storage.getPresignedGetUrl(resume.fileKey, 900);
    return { url, expiresIn: 900, title: resume.title };
  }

  async attachFileToResume(user: AuthUser, resumeId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File required');
    const { profile, resume } = await this.ownedResume(user.id, resumeId);
    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'cvs',
    );

    const knownSkills = await this.prisma.skill.findMany({
      select: { name: true, slug: true },
      take: 500,
    });
    let parsed = parseCvText('', knownSkills);
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      try {
        const result = await pdfParse(file.buffer);
        parsed = parseCvText(result.text || '', knownSkills);
      } catch {
        parsed = {
          ...parseCvText('', knownSkills),
          textPreview: 'Could not parse PDF text',
        };
      }
    }

    const updated = await this.prisma.resume.update({
      where: { id: resume.id },
      data: {
        fileKey: uploaded.key,
        fileUrl: null, // use presigned download endpoint
        parsedData: parsed as object,
        content: parsed.textPreview || resume.content,
        title: resume.title || file.originalname,
      },
    });

    return {
      ...this.sanitizeResume(updated),
      parsedData: parsed,
      profileId: profile.id,
      needsReview: true,
    };
  }

  async uploadCv(user: AuthUser, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File required');
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 5MB)');
    }
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const isPdf =
      file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf && !allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF (recommended) or Word documents are supported');
    }

    const profile = await this.getProfileForUser(user.id);
    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'cvs',
    );

    const knownSkills = await this.prisma.skill.findMany({
      select: { name: true, slug: true },
      take: 500,
    });

    let parsed = parseCvText('', knownSkills);
    if (isPdf) {
      try {
        const result = await pdfParse(file.buffer);
        parsed = parseCvText(result.text || '', knownSkills);
      } catch {
        parsed = {
          ...parseCvText('', knownSkills),
          textPreview: 'Could not extract text from this PDF',
        };
      }
    }

    await this.prisma.resume.updateMany({
      where: { profileId: profile.id },
      data: { isPrimary: false },
    });

    const resume = await this.prisma.resume.create({
      data: {
        profileId: profile.id,
        title: file.originalname.replace(/\.[^.]+$/, '') || 'Uploaded CV',
        fileKey: uploaded.key,
        fileUrl: null,
        isPrimary: true,
        parsedData: parsed as object,
        content: parsed.textPreview,
      },
    });

    return {
      ...this.sanitizeResume(resume),
      parsedData: parsed,
      needsReview: true,
    };
  }

  async importParsedResume(
    user: AuthUser,
    resumeId: string,
    selection: {
      headline?: boolean;
      summary?: boolean;
      phone?: boolean;
      skillIndexes?: number[];
      experienceIndexes?: number[];
      educationIndexes?: number[];
      languageIndexes?: number[];
    },
  ) {
    const { profile, resume } = await this.ownedResume(user.id, resumeId);
    const parsed = resume.parsedData as ParsedCvData | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('No parsed CV data on this resume - upload a CV first');
    }

    const profilePatch: Record<string, unknown> = {};
    if (selection.headline && parsed.headline) profilePatch.headline = parsed.headline;
    if (selection.summary && parsed.summary) profilePatch.summary = parsed.summary;
    if (selection.phone && parsed.phone) {
      const phone = normalizePhone(parsed.phone);
      const taken = await this.prisma.employeeProfile.findFirst({
        where: { phone, NOT: { id: profile.id } },
        select: { id: true },
      });
      if (!taken) profilePatch.phone = phone;
    }
    if (Object.keys(profilePatch).length) {
      await this.prisma.employeeProfile.update({
        where: { id: profile.id },
        data: profilePatch,
      });
    }

    const imported = {
      skills: 0,
      experiences: 0,
      educations: 0,
      languages: 0,
      skippedPhoneTaken: Boolean(selection.phone && parsed.phone && !profilePatch.phone),
    };

    for (const idx of selection.skillIndexes || []) {
      const name = parsed.skillNames?.[idx];
      if (!name) continue;
      const { skill } = await resolveSkill(this.prisma, { name, allowCreate: true });
      await this.prisma.profileSkill.upsert({
        where: { profileId_skillId: { profileId: profile.id, skillId: skill.id } },
        create: { profileId: profile.id, skillId: skill.id, level: 'INTERMEDIATE' },
        update: {},
      });
      imported.skills += 1;
    }

    for (const idx of selection.experienceIndexes || []) {
      const exp = parsed.experiences?.[idx];
      if (!exp?.title || !exp.companyName) continue;
      await this.prisma.workExperience.create({
        data: {
          profileId: profile.id,
          title: exp.title,
          companyName: exp.companyName,
          description: exp.description,
          startDate: exp.startDate ? new Date(exp.startDate) : new Date(),
          endDate: exp.endDate ? new Date(exp.endDate) : null,
          isCurrent: Boolean(exp.isCurrent),
        },
      });
      imported.experiences += 1;
    }

    for (const idx of selection.educationIndexes || []) {
      const edu = parsed.educations?.[idx];
      if (!edu?.school) continue;
      await this.prisma.education.create({
        data: {
          profileId: profile.id,
          school: edu.school,
          degree: edu.degree as never,
          field: edu.field,
          startDate: edu.startDate ? new Date(edu.startDate) : null,
          endDate: edu.endDate ? new Date(edu.endDate) : null,
        },
      });
      imported.educations += 1;
    }

    for (const idx of selection.languageIndexes || []) {
      const lang = parsed.languages?.[idx];
      if (!lang) continue;
      let language = lang.code
        ? await this.prisma.language.findUnique({ where: { code: lang.code } })
        : null;
      if (!language) {
        language = await this.prisma.language.findFirst({
          where: { name: { equals: lang.name, mode: 'insensitive' } },
        });
      }
      if (!language) continue;
      await this.prisma.profileLanguage.upsert({
        where: {
          profileId_languageId: { profileId: profile.id, languageId: language.id },
        },
        create: {
          profileId: profile.id,
          languageId: language.id,
          level: (lang.level || 'B1') as never,
        },
        update: { level: (lang.level || 'B1') as never },
      });
      imported.languages += 1;
    }

    const refreshed = await this.getProfileForUser(user.id);
    return { ok: true, imported, profile: refreshed };
  }

  async searchCandidates(
    user: AuthUser,
    query: {
      q?: string;
      city?: string;
      skills?: string;
      skillMode?: 'AND' | 'OR';
      degree?: string;
      languages?: string;
      experienceYearsMin?: number;
      experienceYearsMax?: number;
      hasCertification?: boolean;
      matchJobId?: string;
      sort?: 'relevance' | 'newest' | 'match';
      page?: number;
      limit?: number;
    },
  ) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    if (query.matchJobId) {
      const matchJob = await this.prisma.jobPost.findUnique({
        where: { id: query.matchJobId },
        select: { id: true, companyId: true },
      });
      if (!matchJob) throw new NotFoundException('Match job not found');
      if (user.role !== 'SUPER_ADMIN') {
        await this.companies.assertMember(user, matchJob.companyId);
      }
    }

    const membership = user.memberships?.[0];
    let limited = true;
    if (membership) {
      const sub = await this.prisma.subscription.findUnique({
        where: { companyId: membership.companyId },
      });
      const plan = sub?.plan ?? 'FREE';
      limited = PLAN_LIMITS[plan].candidateSearch === 'limited';
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const and: Prisma.EmployeeProfileWhereInput[] = [
      { visibility: { in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] } },
    ];

    const citySlugs = (query.city || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (citySlugs.length) and.push({ city: { slug: { in: citySlugs } } });

    const skillSlugs = (query.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (skillSlugs.length) {
      if (query.skillMode === 'AND') {
        for (const slug of skillSlugs) {
          and.push({ skills: { some: { skill: { slug } } } });
        }
      } else {
        and.push({ skills: { some: { skill: { slug: { in: skillSlugs } } } } });
      }
    }

    if (query.degree) {
      and.push({ educations: { some: { degree: query.degree as never } } });
    }

    const langCodes = (query.languages || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (langCodes.length) {
      and.push({ languages: { some: { language: { code: { in: langCodes } } } } });
    }

    if (query.hasCertification) {
      and.push({ certifications: { some: {} } });
    }

    if (query.q) {
      const term = query.q.trim();
      and.push({
        OR: [
          { headline: { contains: term, mode: 'insensitive' } },
          { summary: { contains: term, mode: 'insensitive' } },
          { desiredPosition: { contains: term, mode: 'insensitive' } },
          { user: { fullName: { contains: term, mode: 'insensitive' } } },
          { skills: { some: { skill: { name: { contains: term, mode: 'insensitive' } } } } },
          {
            experiences: {
              some: {
                OR: [
                  { title: { contains: term, mode: 'insensitive' } },
                  { companyName: { contains: term, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      });
    }

    const where: Prisma.EmployeeProfileWhereInput = { AND: and };
    const sort = query.sort ?? 'relevance';
    const needsExperienceFilter =
      query.experienceYearsMin !== undefined || query.experienceYearsMax !== undefined;
    const needsMatchRank = Boolean(query.matchJobId) && sort === 'match';
    /** Experience years + match scoring happen in memory — bound the scan window. */
    const SCAN_CAP = needsMatchRank ? 250 : 1000;
    const needsScan = needsExperienceFilter || needsMatchRank;

    const candidateInclude = {
      user: {
        select: {
          id: true,
          fullName: true,
          email: limited ? false : true,
          avatarUrl: true,
        },
      },
      skills: { include: { skill: true } },
      city: true,
      experiences: true,
      educations: true,
      languages: { include: { language: true } },
      certifications: true,
      _count: { select: { certifications: true } },
    };

    const matchedTotal = await this.prisma.employeeProfile.count({ where });
    let currentPage = Math.max(1, page);
    let truncated = false;
    let total = matchedTotal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pageItems: any[] = [];
    let facetSource: Array<{
      city?: { slug: string; name: string } | null;
      skills: Array<{ skill: { slug: string; name: string } }>;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapProfile = (p: any) => {
      const years = this.matching.totalExperienceYears(p.experiences);
      return {
        ...p,
        experienceYears: years,
        user: {
          id: p.user.id,
          fullName: p.user.fullName,
          avatarUrl: p.user.avatarUrl,
          email: limited ? undefined : (p.user as { email?: string }).email,
        },
        contactsBlurred: limited,
        matchScore: null as number | null,
        matchBreakdown: null as unknown,
      };
    };

    if (!needsScan) {
      // Pure DB pagination for relevance/newest (and match without job id).
      const totalPages = Math.max(1, Math.ceil(matchedTotal / limit) || 1);
      currentPage = Math.min(currentPage, matchedTotal === 0 ? 1 : totalPages);
      const items = await this.prisma.employeeProfile.findMany({
        where,
        include: candidateInclude,
        skip: (currentPage - 1) * limit,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      });
      pageItems = items.map(mapProfile);

      if (query.matchJobId) {
        pageItems = await Promise.all(
          pageItems.map(async (p) => {
            try {
              const breakdown = await this.matching.scoreProfileAgainstJob(p.id, query.matchJobId!);
              return { ...p, matchScore: breakdown.total, matchBreakdown: breakdown };
            } catch {
              return p;
            }
          }),
        );
      }

      facetSource = await this.prisma.employeeProfile.findMany({
        where,
        select: {
          city: { select: { slug: true, name: true } },
          skills: { select: { skill: { select: { slug: true, name: true } } } },
        },
        take: 1000,
        orderBy: { updatedAt: 'desc' },
      });
    } else {
      truncated = matchedTotal > SCAN_CAP;
      const items = await this.prisma.employeeProfile.findMany({
        where,
        include: candidateInclude,
        take: SCAN_CAP,
        orderBy: { updatedAt: 'desc' },
      });

      let scored = items.map(mapProfile);

      if (query.experienceYearsMin !== undefined) {
        scored = scored.filter((p) => p.experienceYears >= query.experienceYearsMin!);
      }
      if (query.experienceYearsMax !== undefined) {
        scored = scored.filter((p) => p.experienceYears <= query.experienceYearsMax!);
      }

      if (query.matchJobId) {
        scored = await Promise.all(
          scored.map(async (p) => {
            try {
              const breakdown = await this.matching.scoreProfileAgainstJob(p.id, query.matchJobId!);
              return { ...p, matchScore: breakdown.total, matchBreakdown: breakdown };
            } catch {
              return p;
            }
          }),
        );
        if (sort === 'match') {
          scored.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
        }
      }

      // Advertise pages only for the ranked/filtered window.
      total = scored.length;
      const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
      currentPage = Math.min(currentPage, total === 0 ? 1 : totalPages);
      pageItems = scored.slice((currentPage - 1) * limit, currentPage * limit);
      facetSource = scored;
    }

    const cityFacets: Record<string, { slug: string; name: string; count: number }> = {};
    const skillFacets: Record<string, { slug: string; name: string; count: number }> = {};
    for (const p of facetSource) {
      if (p.city) {
        const key = p.city.slug;
        cityFacets[key] = cityFacets[key]
          ? { ...cityFacets[key], count: cityFacets[key].count + 1 }
          : { slug: p.city.slug, name: p.city.name, count: 1 };
      }
      for (const s of p.skills) {
        const key = s.skill.slug;
        skillFacets[key] = skillFacets[key]
          ? { ...skillFacets[key], count: skillFacets[key].count + 1 }
          : { slug: s.skill.slug, name: s.skill.name, count: 1 };
      }
    }

    return {
      items: pageItems,
      total,
      matchedTotal,
      truncated,
      page: currentPage,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
      limited,
      facets: {
        cities: Object.values(cityFacets).sort((a, b) => b.count - a.count).slice(0, 80),
        skills: Object.values(skillFacets).sort((a, b) => b.count - a.count).slice(0, 80),
      },
    };
  }

  async getCandidateProfile(user: AuthUser, profileId: string, matchJobId?: string) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    const membership = user.memberships?.[0];
    let limited = true;
    if (user.role === 'SUPER_ADMIN') limited = false;
    else if (membership) {
      const sub = await this.prisma.subscription.findUnique({
        where: { companyId: membership.companyId },
      });
      const plan = sub?.plan ?? 'FREE';
      limited = PLAN_LIMITS[plan].candidateSearch === 'limited';
    }

    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, avatarUrl: true, locale: true },
        },
        skills: { include: { skill: true } },
        experiences: { include: { city: true }, orderBy: { startDate: 'desc' } },
        educations: { orderBy: { startDate: 'desc' } },
        certifications: true,
        languages: { include: { language: true } },
        resumes: { where: { isPrimary: true }, take: 1 },
        city: true,
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not available');
    }

    const companyIds = (user.memberships ?? [])
      .map((m) => m.companyId)
      .filter(Boolean);

    // Applicants to this recruiter's company must remain viewable even if PRIVATE.
    const applied =
      user.role === 'SUPER_ADMIN'
        ? { id: 'admin' }
        : companyIds.length
          ? await this.prisma.application.findFirst({
              where: {
                profileId,
                jobPost: { companyId: { in: companyIds } },
              },
              select: { id: true },
            })
          : null;
    const appliedToMyCompany = Boolean(applied);

    if (profile.visibility === 'PRIVATE' && !appliedToMyCompany) {
      throw new NotFoundException('Profile not available');
    }

    // Recruiter can always see contacts of candidates who applied to their company
    if (limited && appliedToMyCompany) {
      limited = false;
    }

    const experienceYears = this.matching.totalExperienceYears(profile.experiences);

    let match: unknown = null;
    if (matchJobId) {
      const matchJob = await this.prisma.jobPost.findUnique({
        where: { id: matchJobId },
        select: { id: true, companyId: true },
      });
      if (!matchJob) throw new NotFoundException('Match job not found');
      if (user.role !== 'SUPER_ADMIN') {
        await this.companies.assertMember(user, matchJob.companyId);
      }
      try {
        match = await this.matching.scoreProfileAgainstJob(profileId, matchJobId);
      } catch {
        match = null;
      }
    }

    const safe = this.sanitizeProfileResumes(profile);
    return {
      ...safe,
      user: {
        ...safe.user,
        email: limited ? undefined : safe.user.email,
      },
      phone: limited ? undefined : safe.phone,
      contactsBlurred: limited,
      experienceYears,
      match,
      appliedToMyCompany,
    };
  }

  async saveJob(user: AuthUser, jobPostId: string) {
    const profile = await this.getProfileForUser(user.id);
    return this.prisma.savedJob.upsert({
      where: { profileId_jobPostId: { profileId: profile.id, jobPostId } },
      create: { profileId: profile.id, jobPostId },
      update: {},
    });
  }

  async unsaveJob(user: AuthUser, jobPostId: string) {
    const profile = await this.getProfileForUser(user.id);
    await this.prisma.savedJob.deleteMany({ where: { profileId: profile.id, jobPostId } });
    return { ok: true };
  }

  async listSaved(user: AuthUser) {
    const profile = await this.getProfileForUser(user.id);
    return this.prisma.savedJob.findMany({
      where: { profileId: profile.id },
      include: {
        jobPost: {
          include: {
            company: { select: { id: true, name: true, slug: true, logoUrl: true } },
            city: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
