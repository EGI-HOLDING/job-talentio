import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import type IORedis from 'ioredis';
import {
  PLAN_LIMITS,
  normalizeResumeInclusion,
  scoreResumeChecklist,
  DEFAULT_RESUME_INCLUSION,
  levelsAtOrAbove,
  parseLanguagesCsv,
  MAX_RESUMES_PER_PROFILE,
} from '@job-talentio/shared';
import { LanguageLevel, Prisma } from '@prisma/client';
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
import { normalizeJobTitleKey, resolveJobTitle } from '../common/title-resolve';
import { detectLocale } from '../common/i18n/detect-locale';
import { resolveContent } from '../common/i18n/content-locale';
import { DEFAULT_LOCALE, isLocale } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { TranslationService } from '../translation/translation.service';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { ParsedCvData } from './cv-parser';
import { CvParseService } from './cv-parse.service';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { PresenceService } from '../presence/presence.service';

const resumeTargetTitleInclude = {
  targetJobTitle: { select: { id: true, name: true, nameUz: true, nameRu: true, slug: true } },
} as const;

/** Contact reveals allowed per recruiter per hour (anti bulk harvesting). */
const REVEAL_LIMIT_PER_HOUR = 30;

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private companies: CompaniesService,
    private matching: MatchingService,
    private cvParse: CvParseService,
    private presence: PresenceService,
    private translation: TranslationService,
    @Optional() @Inject(RATE_LIMIT_REDIS) private readonly rlRedis: IORedis | null,
  ) {}

  private profileInclude = {
    skills: { include: { skill: true } },
    experiences: { include: { city: true } },
    educations: true,
    certifications: true,
    languages: { include: { language: true } },
    resumes: {
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' as const },
      include: resumeTargetTitleInclude,
    },
    city: true,
    user: {
      select: {
        id: true,
        fullName: true,
        email: true,
        locale: true,
        avatarUrl: true,
        emailVerified: true,
      },
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

  private sourceNarrativeLocale(
    contentLocale?: string | null,
    headline?: string | null,
    summary?: string | null,
  ): Locale {
    if (isLocale(contentLocale)) return contentLocale;
    return detectLocale([headline, summary].filter(Boolean).join('\n')) ?? DEFAULT_LOCALE;
  }

  /** List/pipeline cards only need a localized headline when a cache row exists. */
  private resolveHeadlineForList<
    T extends {
      headline?: string | null;
      contentLocale?: string | null;
      translations?: Array<{ locale: string; headline?: string | null; isMachine: boolean }>;
    },
  >(profile: T, locale: Locale): T {
    const { translations, ...rest } = profile;
    if (!translations?.length) return rest as T;
    const source = this.sourceNarrativeLocale(rest.contentLocale, rest.headline, null);
    const resolved = resolveContent(
      { headline: rest.headline ?? '' },
      source,
      translations.map((row) => ({
        locale: row.locale,
        headline: row.headline ?? '',
        isMachine: row.isMachine,
      })),
      locale,
    );
    return { ...rest, headline: resolved.content.headline || rest.headline } as T;
  }

  private localizeCandidateProfile<
    T extends {
      headline?: string | null;
      summary?: string | null;
      contentLocale?: string | null;
      translations?: Array<{
        locale: string;
        headline?: string | null;
        summary?: string | null;
        isMachine: boolean;
      }>;
      experiences: Array<{
        title: string;
        description?: string | null;
        translations?: Array<{
          locale: string;
          title: string;
          description?: string | null;
          isMachine: boolean;
        }>;
      }>;
      educations: Array<{
        field?: string | null;
        translations?: Array<{ locale: string; field?: string | null; isMachine: boolean }>;
      }>;
    },
  >(profile: T, locale: Locale) {
    const { translations = [], ...rest } = profile;
    const source = this.sourceNarrativeLocale(rest.contentLocale, rest.headline, rest.summary);
    const resolved = resolveContent(
      { headline: rest.headline ?? '', summary: rest.summary ?? '' },
      source,
      translations.map((row) => ({
        locale: row.locale,
        headline: row.headline ?? '',
        summary: row.summary ?? '',
        isMachine: row.isMachine,
      })),
      locale,
    );

    let anyFallback = resolved.isFallback && Boolean(rest.headline?.trim() || rest.summary?.trim());

    const experiences = rest.experiences.map((exp) => {
      const { translations: expT = [], ...e } = exp;
      const r = resolveContent(
        { title: e.title, description: e.description ?? '' },
        source,
        expT.map((row) => ({
          locale: row.locale,
          title: row.title,
          description: row.description ?? '',
          isMachine: row.isMachine,
        })),
        locale,
      );
      if (r.isFallback && (e.title.trim() || e.description?.trim())) anyFallback = true;
      return {
        ...e,
        title: r.content.title,
        description: e.description == null ? r.content.description || null : r.content.description,
        contentLocale: r.contentLocale,
        isMachineTranslated: r.isMachineTranslated,
      };
    });

    const educations = rest.educations.map((edu) => {
      const { translations: eduT = [], ...e } = edu;
      if (!e.field?.trim()) {
        return { ...e, contentLocale: source, isMachineTranslated: false };
      }
      const r = resolveContent(
        { field: e.field },
        source,
        eduT.map((row) => ({
          locale: row.locale,
          field: row.field ?? '',
          isMachine: row.isMachine,
        })),
        locale,
      );
      if (r.isFallback) anyFallback = true;
      return {
        ...e,
        field: r.content.field,
        contentLocale: r.contentLocale,
        isMachineTranslated: r.isMachineTranslated,
      };
    });

    return {
      ...rest,
      headline: resolved.content.headline || rest.headline,
      summary: resolved.content.summary || rest.summary,
      contentLocale: resolved.contentLocale,
      isMachineTranslated: resolved.isMachineTranslated,
      experiences,
      educations,
      canMachineTranslate: this.translation.enabled && anyFallback,
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

    const headline = data.headline as string | undefined;
    const summary = data.summary as string | undefined;

    try {
      return await this.prisma.employeeProfile.update({
        where: { userId: user.id },
        data: {
          headline,
          summary,
          // Narrative text is never translated; recording its language lets
          // recruiters browsing in another one see why it reads differently.
          contentLocale: this.narrativeLocale(
            headline ?? profile.headline,
            summary ?? profile.summary,
          ),
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

  /** Null when the text is too short or mixed to call, so no badge is shown. */
  private narrativeLocale(headline?: string | null, summary?: string | null): string | null {
    const text = [headline, summary].filter(Boolean).join('\n');
    if (!text.trim()) return null;
    return detectLocale(text);
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
      const city = await this.prisma.city.findFirst({
        where: { slug: String(data.citySlug), ...ACTIVE_CATALOG },
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
    const city = await this.prisma.city.findFirst({
      where: { slug: String(citySlug), ...ACTIVE_CATALOG },
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

  private async assertResumeQuota(profileId: string) {
    const count = await this.prisma.resume.count({
      where: { profileId, deletedAt: null },
    });
    if (count >= MAX_RESUMES_PER_PROFILE) {
      throw new BadRequestException(
        `Resume limit reached (${MAX_RESUMES_PER_PROFILE}). Delete an old resume first.`,
      );
    }
  }

  private async resolveTargetJobTitleId(opts: {
    jobTitleSlug?: string | null;
    jobTitle?: string | null;
  }): Promise<string | null> {
    const name = (opts.jobTitle || opts.jobTitleSlug || '').trim();
    const slug = opts.jobTitleSlug?.trim();
    if (!name && !slug) return null;
    const resolved = await resolveJobTitle(this.prisma, {
      name: name || slug || 'Role',
      slug: slug || undefined,
    });
    return resolved.jobTitle.id;
  }

  async createResume(
    user: AuthUser,
    data: {
      title: string;
      content?: string;
      isPrimary?: boolean;
      jobTitleSlug?: string;
      jobTitle?: string;
    },
  ) {
    const profile = await this.getProfileForUser(user.id);
    await this.assertResumeQuota(profile.id);
    const targetJobTitleId = await this.resolveTargetJobTitleId(data);
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: profile.id },
        data: { isPrimary: false },
      });
    }
    const created = await this.prisma.resume.create({
      data: {
        profileId: profile.id,
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary ?? false,
        targetJobTitleId,
      },
      include: resumeTargetTitleInclude,
    });
    return this.sanitizeResume(created);
  }

  async updateResume(
    user: AuthUser,
    resumeId: string,
    data: {
      title?: string;
      content?: string;
      isPrimary?: boolean;
      jobTitleSlug?: string;
      jobTitle?: string;
    },
  ) {
    const profile = await this.getProfileForUser(user.id);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id, deletedAt: null },
    });
    if (!resume) throw new NotFoundException();
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: profile.id },
        data: { isPrimary: false },
      });
    }
    const touchRole = data.jobTitle !== undefined || data.jobTitleSlug !== undefined;
    const targetJobTitleId = touchRole
      ? await this.resolveTargetJobTitleId(data)
      : undefined;
    const updated = await this.prisma.resume.update({
      where: { id: resumeId },
      data: {
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary,
        ...(touchRole ? { targetJobTitleId } : {}),
      },
      include: resumeTargetTitleInclude,
    });
    return this.sanitizeResume(updated);
  }

  /**
   * Delete an S3 object only when no Resume.fileKey and no Application.resumeSnapshot
   * still point at it (apply durability must keep the applied PDF).
   */
  private async deleteStorageKeyIfOrphan(fileKey: string | null | undefined): Promise<boolean> {
    const key = (fileKey || '').trim();
    if (!key) return false;

    const resumeRefs = await this.prisma.resume.count({ where: { fileKey: key } });
    if (resumeRefs > 0) return false;

    const snapshotRefs = await this.prisma.application.count({
      where: {
        resumeSnapshot: {
          path: ['resume', 'fileKey'],
          equals: key,
        },
      },
    });
    if (snapshotRefs > 0) return false;

    await this.storage.delete(key);
    return true;
  }

  /** Hard-delete soft-deleted resume (+ S3) when no applications still reference it. */
  async purgeResumeIfOrphan(resumeId: string): Promise<{ purged: boolean }> {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      include: { _count: { select: { applications: true } } },
    });
    if (!resume || !resume.deletedAt) return { purged: false };
    if (resume._count.applications > 0) return { purged: false };
    const fileKey = resume.fileKey;
    await this.prisma.resume.delete({ where: { id: resumeId } });
    await this.deleteStorageKeyIfOrphan(fileKey);
    return { purged: true };
  }

  /** After applications cascade away, purge any soft-deleted resumes that became orphaned. */
  async purgeOrphanSoftDeletedResumes(resumeIds: string[]) {
    const unique = [...new Set(resumeIds.filter(Boolean))];
    for (const id of unique) {
      await this.purgeResumeIfOrphan(id);
    }
  }

  /** Sweep all soft-deleted resumes with zero application refs (e.g. after job hard-delete). */
  async purgeAllOrphanSoftDeletedResumes() {
    const soft = await this.prisma.resume.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
    let purged = 0;
    for (const row of soft) {
      const r = await this.purgeResumeIfOrphan(row.id);
      if (r.purged) purged += 1;
    }
    return { purged };
  }

  async deleteResume(user: AuthUser, resumeId: string) {
    const profile = await this.getProfileForUser(user.id);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id, deletedAt: null },
    });
    if (!resume) throw new NotFoundException('Resume not found');

    const appCount = await this.prisma.application.count({ where: { resumeId } });
    if (appCount === 0) {
      const fileKey = resume.fileKey;
      await this.prisma.resume.delete({ where: { id: resumeId } });
      await this.deleteStorageKeyIfOrphan(fileKey);
      return { ok: true, softDeleted: false, hardDeleted: true };
    }

    await this.prisma.resume.update({
      where: { id: resumeId },
      data: { deletedAt: new Date(), isPrimary: false },
    });
    const nextPrimary = await this.prisma.resume.findFirst({
      where: { profileId: profile.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    if (nextPrimary) {
      await this.prisma.resume.update({
        where: { id: nextPrimary.id },
        data: { isPrimary: true },
      });
    }
    return {
      ok: true,
      softDeleted: true,
      hardDeleted: false,
      message:
        'Removed from your library. The file stays available for applications already submitted.',
    };
  }

  async restoreResume(user: AuthUser, resumeId: string) {
    const profile = await this.getProfileForUser(user.id);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id, deletedAt: { not: null } },
    });
    if (!resume) throw new NotFoundException('Resume not found');
    await this.prisma.resume.update({
      where: { id: resumeId },
      data: { deletedAt: null },
    });
    return this.sanitizeResume(
      await this.prisma.resume.findUniqueOrThrow({ where: { id: resumeId } }),
    );
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
        resumes: { where: { deletedAt: null }, orderBy: { updatedAt: 'desc' } },
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
      jobTitleSlug?: string;
      jobTitle?: string;
    },
  ) {
    const profile = await this.getProfileForUser(user.id);
    await this.assertResumeQuota(profile.id);
    const targetJobTitleId = await this.resolveTargetJobTitleId(data);
    const makePrimary = data.isPrimary !== false;
    if (makePrimary) {
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
        isPrimary: makePrimary,
        targetJobTitleId,
      },
      include: resumeTargetTitleInclude,
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
      jobTitleSlug?: string;
      jobTitle?: string;
    },
  ) {
    const { resume } = await this.ownedResume(user.id, resumeId);
    if (data.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { profileId: resume.profileId },
        data: { isPrimary: false },
      });
    }
    const touchRole = data.jobTitle !== undefined || data.jobTitleSlug !== undefined;
    const targetJobTitleId = touchRole
      ? await this.resolveTargetJobTitleId(data)
      : undefined;
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
        ...(touchRole ? { targetJobTitleId } : {}),
      },
      include: resumeTargetTitleInclude,
    });
    return this.sanitizeResume(updated);
  }

  async exportResumePdf(user: AuthUser, resumeId: string) {
    const { resume: owned } = await this.ownedResume(user.id, resumeId);
    const previousKey = owned.fileKey;
    const payload = await this.getResumeDocument(user, resumeId);
    if (!payload.resume) throw new NotFoundException('Resume not found');
    const { buildResumePdfBuffer } = await import('./resume-pdf');
    let buffer: Buffer;
    try {
      buffer = await buildResumePdfBuffer({
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Could not generate resume PDF. Check that your profile text is valid. (${msg.slice(0, 160)})`,
      );
    }

    let uploaded: { key: string; url: string };
    try {
      uploaded = await this.storage.upload(
        buffer,
        `${payload.resume.title || 'resume'}.pdf`,
        'application/pdf',
        'cvs',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Could not store exported PDF: ${msg.slice(0, 160)}`);
    }
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
      include: resumeTargetTitleInclude,
    });
    if (previousKey && previousKey !== uploaded.key) {
      await this.deleteStorageKeyIfOrphan(previousKey);
    }
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
      where: { id: resumeId, profileId: profile.id, deletedAt: null },
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
    // Soft-deleted library items stay downloadable for recruiters (and restore for owner).
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
    return { url, expiresIn: 900, title: resume.title, softDeleted: Boolean(resume.deletedAt) };
  }

  async attachFileToResume(user: AuthUser, resumeId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File required');
    const { profile, resume } = await this.ownedResume(user.id, resumeId);
    const previousKey = resume.fileKey;
    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'cvs',
    );

    const updated = await this.prisma.resume.update({
      where: { id: resume.id },
      data: {
        fileKey: uploaded.key,
        fileUrl: null,
        title: resume.title || file.originalname,
        parsedData: Prisma.DbNull,
        parseStatus: 'NONE',
        parseError: null,
        parsedAt: null,
      },
    });

    if (previousKey && previousKey !== uploaded.key) {
      await this.deleteStorageKeyIfOrphan(previousKey);
    }

    return {
      ...this.sanitizeResume(updated),
      parseStatus: 'NONE' as const,
      profileId: profile.id,
      needsReview: false,
    };
  }

  async uploadCv(
    user: AuthUser,
    file: Express.Multer.File,
    meta?: { title?: string; jobTitle?: string; jobTitleSlug?: string; parse?: boolean },
  ) {
    if (!file) throw new BadRequestException('File required');
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('File too large (max 5MB)');
    }
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    const isPdf =
      file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf && !allowed.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF (recommended) or Word documents are supported');
    }

    const profile = await this.getProfileForUser(user.id);
    await this.assertResumeQuota(profile.id);
    const targetJobTitleId = await this.resolveTargetJobTitleId({
      jobTitle: meta?.jobTitle,
      jobTitleSlug: meta?.jobTitleSlug,
    });
    let resolvedTitle =
      (meta?.title || '').trim() ||
      file.originalname.replace(/\.[^.]+$/, '') ||
      'Uploaded CV';
    if (targetJobTitleId && !(meta?.title || '').trim()) {
      const jt = await this.prisma.jobTitle.findUnique({
        where: { id: targetJobTitleId },
        select: { name: true },
      });
      if (jt?.name) resolvedTitle = jt.name;
    }

    const uploaded = await this.storage.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'cvs',
    );

    await this.prisma.resume.updateMany({
      where: { profileId: profile.id },
      data: { isPrimary: false },
    });

    const shouldParse = Boolean(meta?.parse);
    const resume = await this.prisma.resume.create({
      data: {
        profileId: profile.id,
        title: resolvedTitle,
        fileKey: uploaded.key,
        fileUrl: null,
        isPrimary: true,
        parseStatus: shouldParse ? 'PENDING' : 'NONE',
        targetJobTitleId,
      },
      include: resumeTargetTitleInclude,
    });

    if (shouldParse) {
      await this.cvParse.enqueue(resume.id);
    }

    return {
      ...this.sanitizeResume(resume),
      parseStatus: resume.parseStatus,
      needsReview: false,
    };
  }

  async getResumeParseStatus(user: AuthUser, resumeId: string) {
    const { resume } = await this.ownedResume(user.id, resumeId);
    return {
      id: resume.id,
      parseStatus: resume.parseStatus,
      parseError: resume.parseError,
      parsedAt: resume.parsedAt,
      parsedData: resume.parsedData,
      needsReview: resume.parseStatus === 'READY' && Boolean(resume.parsedData),
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
      if (profilePatch.headline || profilePatch.summary) {
        profilePatch.contentLocale = this.narrativeLocale(
          (profilePatch.headline as string) ?? profile.headline,
          (profilePatch.summary as string) ?? profile.summary,
        );
      }
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

  private profileTitleTexts(p: {
    desiredPosition?: string | null;
    headline?: string | null;
    experiences?: Array<{ title?: string | null }>;
  }): string[] {
    const texts = [p.desiredPosition, p.headline, ...(p.experiences || []).map((e) => e.title)];
    return texts.map((t) => (t || '').trim()).filter(Boolean);
  }

  private profileMatchesTitleKeys(
    p: {
      desiredPosition?: string | null;
      headline?: string | null;
      experiences?: Array<{ title?: string | null }>;
    },
    keys: Set<string>,
  ): boolean {
    if (!keys.size) return true;
    for (const text of this.profileTitleTexts(p)) {
      const key = normalizeJobTitleKey(text);
      if (key && keys.has(key)) return true;
    }
    return false;
  }

  async searchCandidates(
    user: AuthUser,
    query: {
      q?: string;
      city?: string;
      skills?: string;
      skillMode?: 'AND' | 'OR';
      jobTitle?: string;
      degree?: string;
      languages?: string;
      experienceYearsMin?: number;
      experienceYearsMax?: number;
      hasCertification?: boolean;
      matchJobId?: string;
      sort?: 'relevance' | 'newest' | 'match';
      page?: number;
      limit?: number;
      locale?: Locale;
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
    const locale = query.locale ?? DEFAULT_LOCALE;
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

    const languageTokens = parseLanguagesCsv(query.languages);
    if (languageTokens.length) {
      and.push({
        OR: languageTokens.map((token) => ({
          languages: {
            some: {
              language: { code: token.code },
              level: { in: levelsAtOrAbove(token.minLevel) as LanguageLevel[] },
            },
          },
        })),
      });
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

    const titleSlugs = (query.jobTitle || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const titleKeySet = new Set<string>();
    if (titleSlugs.length) {
      const catalog = await this.prisma.jobTitle.findMany({
        where: { slug: { in: titleSlugs } },
        include: { aliases: true },
      });
      for (const t of catalog) {
        if (t.normalizedKey) titleKeySet.add(t.normalizedKey);
        const keyFromName = normalizeJobTitleKey(t.name);
        if (keyFromName) titleKeySet.add(keyFromName);
      }
      const terms = [
        ...new Set(
          catalog.flatMap((t) => [t.name, ...t.aliases.map((a) => a.alias)].filter(Boolean)),
        ),
      ];
      if (terms.length) {
        and.push({
          OR: terms.flatMap((term) => [
            { desiredPosition: { contains: term, mode: 'insensitive' as const } },
            { headline: { contains: term, mode: 'insensitive' as const } },
            { experiences: { some: { title: { contains: term, mode: 'insensitive' as const } } } },
          ]),
        });
      } else {
        // Unknown slugs → empty result
        and.push({ id: '__no_such_job_title__' });
      }
    }

    const where: Prisma.EmployeeProfileWhereInput = { AND: and };
    const sort = query.sort ?? 'relevance';
    const needsExperienceFilter =
      query.experienceYearsMin !== undefined || query.experienceYearsMax !== undefined;
    const needsMatchRank = Boolean(query.matchJobId) && sort === 'match';
    const needsTitleKeyFilter = titleKeySet.size > 0;
    /** Experience years + match scoring + title-key precision happen in memory — bound the scan window. */
    const SCAN_CAP = needsMatchRank ? 250 : 1000;
    const needsScan = needsExperienceFilter || needsMatchRank || needsTitleKeyFilter;

    const candidateInclude = {
      // Contacts never appear in search payloads; reveals go through the
      // audited click-to-reveal endpoint.
      user: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
      skills: { include: { skill: true } },
      city: true,
      experiences: true,
      educations: true,
      languages: { include: { language: true } },
      certifications: true,
      translations: { select: { locale: true, headline: true, isMachine: true } },
      _count: { select: { certifications: true } },
    };

    const matchedTotal = await this.prisma.employeeProfile.count({ where });
    let currentPage = Math.max(1, page);
    let truncated = false;
    let total = matchedTotal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pageItems: any[] = [];
    let facetSource: Array<{
      city?: {
        slug: string;
        name: string;
        nameUz?: string | null;
        nameRu?: string | null;
        archivedAt?: Date | null;
      } | null;
      skills: Array<{
        skill: {
          slug: string;
          name: string;
          nameUz?: string | null;
          nameRu?: string | null;
          archivedAt?: Date | null;
        };
      }>;
      desiredPosition?: string | null;
      headline?: string | null;
      experiences?: Array<{ title?: string | null }>;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapProfile = (p: any) => {
      const years = this.matching.totalExperienceYears(p.experiences);
      const localized = this.resolveHeadlineForList(p, locale);
      return {
        ...localized,
        experienceYears: years,
        user: {
          id: p.user.id,
          fullName: p.user.fullName,
          avatarUrl: p.user.avatarUrl,
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
          city: {
            select: { slug: true, name: true, nameUz: true, nameRu: true, archivedAt: true },
          },
          skills: {
            select: {
              skill: {
                select: { slug: true, name: true, nameUz: true, nameRu: true, archivedAt: true },
              },
            },
          },
          desiredPosition: true,
          headline: true,
          experiences: { select: { title: true }, take: 5, orderBy: { startDate: 'desc' } },
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

      if (needsTitleKeyFilter) {
        scored = scored.filter((p) => this.profileMatchesTitleKeys(p, titleKeySet));
      }

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

    type Facet = {
      slug: string;
      name: string;
      nameUz?: string | null;
      nameRu?: string | null;
      count: number;
    };
    const cityFacets: Record<string, Facet> = {};
    const skillFacets: Record<string, Facet> = {};
    const titleFacets: Record<string, Facet> = {};

    const catalogTitles = await this.prisma.jobTitle.findMany({
      where: ACTIVE_CATALOG,
      select: { slug: true, name: true, nameUz: true, nameRu: true, normalizedKey: true },
    });
    const catalogByKey = new Map<
      string,
      { slug: string; name: string; nameUz?: string | null; nameRu?: string | null }
    >();
    for (const t of catalogTitles) {
      const key = t.normalizedKey || normalizeJobTitleKey(t.name);
      if (key && !catalogByKey.has(key)) {
        catalogByKey.set(key, { slug: t.slug, name: t.name, nameUz: t.nameUz, nameRu: t.nameRu });
      }
    }

    // Archived entries stay on the candidate cards that use them but are not
    // offered as filter options.
    for (const p of facetSource) {
      if (p.city && !p.city.archivedAt) {
        const key = p.city.slug;
        cityFacets[key] = cityFacets[key]
          ? { ...cityFacets[key], count: cityFacets[key].count + 1 }
          : { slug: p.city.slug, name: p.city.name, nameUz: p.city.nameUz, nameRu: p.city.nameRu, count: 1 };
      }
      for (const s of p.skills) {
        if (s.skill.archivedAt) continue;
        const key = s.skill.slug;
        skillFacets[key] = skillFacets[key]
          ? { ...skillFacets[key], count: skillFacets[key].count + 1 }
          : {
              slug: s.skill.slug,
              name: s.skill.name,
              nameUz: s.skill.nameUz,
              nameRu: s.skill.nameRu,
              count: 1,
            };
      }
      const seenKeys = new Set<string>();
      for (const text of this.profileTitleTexts(p)) {
        const key = normalizeJobTitleKey(text);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        const cat = catalogByKey.get(key);
        if (!cat) continue;
        titleFacets[cat.slug] = titleFacets[cat.slug]
          ? { ...titleFacets[cat.slug], count: titleFacets[cat.slug].count + 1 }
          : { slug: cat.slug, name: cat.name, nameUz: cat.nameUz, nameRu: cat.nameRu, count: 1 };
      }
    }

    const presenceMap = await this.presence.getPresence(
      pageItems.map((p) => p.user?.id as string).filter(Boolean),
    );
    pageItems = pageItems.map((p) => ({
      ...p,
      presence: (p.user?.id && presenceMap[p.user.id]) || null,
    }));

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
        jobTitles: Object.values(titleFacets).sort((a, b) => b.count - a.count).slice(0, 80),
      },
    };
  }

  /**
   * Shared contact-access gate: plan-based `limited` plus the override that
   * recruiters always see contacts of candidates who applied to their company.
   */
  private async contactAccessFor(user: AuthUser, profileId: string) {
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

    const companyIds = (user.memberships ?? []).map((m) => m.companyId).filter(Boolean);

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

    if (limited && appliedToMyCompany) {
      limited = false;
    }
    return { limited, appliedToMyCompany };
  }

  async getCandidateProfile(
    user: AuthUser,
    profileId: string,
    matchJobId?: string,
    locale: Locale = DEFAULT_LOCALE,
  ) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      include: {
        user: {
          select: { id: true, fullName: true, avatarUrl: true, locale: true },
        },
        skills: { include: { skill: true } },
        translations: {
          select: { locale: true, headline: true, summary: true, isMachine: true },
        },
        experiences: {
          include: {
            city: true,
            translations: {
              select: { locale: true, title: true, description: true, isMachine: true },
            },
          },
          orderBy: { startDate: 'desc' },
        },
        educations: {
          include: {
            translations: { select: { locale: true, field: true, isMachine: true } },
          },
          orderBy: { startDate: 'desc' },
        },
        certifications: true,
        languages: { include: { language: true } },
        resumes: { where: { isPrimary: true }, take: 1 },
        city: true,
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not available');
    }

    const { limited, appliedToMyCompany } = await this.contactAccessFor(user, profileId);

    if (profile.visibility === 'PRIVATE' && !appliedToMyCompany) {
      throw new NotFoundException('Profile not available');
    }

    const experienceYears = this.matching.totalExperienceYears(profile.experiences);

    let match: unknown = null;
    let applicationForJob: {
      id: string;
      resumeTitle: string | null;
      hasResumeFile: boolean;
    } | null = null;
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

      const application = await this.prisma.application.findUnique({
        where: {
          jobPostId_profileId: { jobPostId: matchJobId, profileId },
        },
        include: { resume: { select: { title: true, fileKey: true } } },
      });
      if (application) {
        const snap = application.resumeSnapshot as
          | { resume?: { title?: string | null; fileKey?: string | null } }
          | null;
        applicationForJob = {
          id: application.id,
          resumeTitle: application.resume?.title ?? snap?.resume?.title ?? null,
          hasResumeFile: Boolean(application.resume?.fileKey || snap?.resume?.fileKey),
        };
      }
    }

    const localized = this.localizeCandidateProfile(profile, locale);
    const safe = this.sanitizeProfileResumes(localized);
    return {
      ...safe,
      // Contacts are never in the profile payload; use POST
      // /profiles/candidates/:id/reveal-contact so reveals are audited
      // and rate limited (anti-scrape).
      phone: undefined,
      contactsBlurred: limited,
      experienceYears,
      match,
      appliedToMyCompany,
      applicationForJob,
      presence: await this.presence.getOne(profile.user.id),
    };
  }

  async machineTranslateCandidate(
    user: AuthUser,
    profileId: string,
    locale: Locale,
    matchJobId?: string,
  ) {
    // Same visibility gate as the profile page; then one provider batch is cached.
    await this.getCandidateProfile(user, profileId, matchJobId, locale);
    const result = await this.translation.translateProfile(profileId, locale);
    if (result.status === 'failed') throw new BadRequestException(result.reason);
    return {
      status: result.status,
      profile: await this.getCandidateProfile(user, profileId, matchJobId, locale),
    };
  }

  /** Click-to-reveal: returns contacts for one candidate, audited + quota'd. */
  async revealCandidateContact(user: AuthUser, profileId: string) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        phone: true,
        visibility: true,
        user: { select: { email: true } },
      },
    });
    if (!profile) throw new NotFoundException('Profile not available');

    const { limited, appliedToMyCompany } = await this.contactAccessFor(user, profileId);
    if (profile.visibility === 'PRIVATE' && !appliedToMyCompany) {
      throw new NotFoundException('Profile not available');
    }
    if (limited) {
      throw new ForbiddenException(
        'Contacts are available on Standard/Premium plans, or after the candidate applies to your company',
      );
    }

    await this.assertRevealQuota(user);

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: 'CANDIDATE_CONTACT_REVEAL',
          entityType: 'EmployeeProfile',
          entityId: profileId,
        },
      });
    } catch (err) {
      this.logger.warn(`Reveal audit write failed: ${(err as Error).message}`);
    }

    return {
      email: profile.user.email ?? null,
      phone: profile.phone ?? null,
    };
  }

  /** Redis hourly quota per recruiter; fails open when Redis is down. */
  private async assertRevealQuota(user: AuthUser) {
    if (!this.rlRedis || this.rlRedis.status !== 'ready') return;
    const window = Math.floor(Date.now() / 3_600_000);
    const key = `rl:reveal:${user.id}:${window}`;
    try {
      const count = await this.rlRedis.incr(key);
      if (count === 1) {
        await this.rlRedis.expire(key, 3_900);
      }
      if (count > REVEAL_LIMIT_PER_HOUR) {
        throw new HttpException(
          'Contact reveal limit reached for this hour. Try again later.',
          429,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis hiccup: allow the reveal rather than blocking paying recruiters.
    }
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
