import { liveJobWhere } from '../benefits/benefit-policy';
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
  normalizeResumeInclusion,
  scoreResumeChecklist,
  DEFAULT_RESUME_INCLUSION,
  levelsAtOrAbove,
  parseLanguagesCsv,
  MAX_RESUMES_PER_PROFILE,
  normalizeE164Phone,
  type ResumeImportInput,
} from '@job-talentio/shared';
import { LanguageLevel, Prisma } from '@prisma/client';
import {
  educationImportKey,
  experienceImportKey,
  pickFilledProfileFields,
  resumeStartDate,
} from './cv-import-merge';
import { CandidateAccessService } from './candidate-access.service';
import { compareRecruiterMatches, type RecruiterBreakdown } from '../matching/recruiter-matching';
import { submittedResume } from '../applications/application-payload';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CompaniesService } from '../companies/companies.service';
import { MatchingService } from '../matching/matching.service';
import { AuthUser } from '../common/auth.decorators';
import { slugify } from '../common/utils';
import { resolveSkill } from '../common/skill-resolve';
import { resolveLanguage } from '../common/language-resolve';
import { resolveCity } from '../common/city-resolve';
import { resolveJobLocation } from '../common/geo-selection';
import { canonicalRoleNames, normalizeJobTitleKey, profileRoleTexts, resolveJobTitle } from '../common/title-resolve';
import { detectLocale, effectiveSourceLocale } from '../common/i18n/detect-locale';
import { resolveUgcContent } from '../common/i18n/content-locale';
import { DEFAULT_LOCALE } from '../common/i18n/locale';
import type { Locale } from '../common/i18n/locale';
import { maskAnonymousCompany } from '../common/anonymous-job';
import { TranslationService } from '../translation/translation.service';
import { ACTIVE_CATALOG } from '../common/catalog-visibility';
import { ParsedCvData } from './cv-parser';
import { CvParseService } from './cv-parse.service';
import { careerDates } from './career-dates';
import { RATE_LIMIT_REDIS } from '../rate-limit/search-rate-limit.guard';
import { PresenceService } from '../presence/presence.service';

const resumeTargetTitleInclude = {
  targetJobTitle: { select: { id: true, name: true, nameUz: true, nameRu: true, nameId: true, slug: true } },
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
    @Optional() private candidateAccess?: CandidateAccessService,
  ) {}

  private profileInclude = {
    skills: { include: { skill: true } },
    experiences: { include: { city: { include: { province: { include: { country: true } } } }, country: true } },
    educations: true,
    certifications: true,
    languages: { include: { language: true } },
    resumes: {
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' as const },
      include: resumeTargetTitleInclude,
    },
    city: { include: { province: { include: { country: true } } } },
    residenceCountry: true,
    preferredCountries: true,
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
    // Unreviewed CV rows may contain excluded/private details. They are only
    // available through the employee's authenticated onboarding endpoint.
    const { onboardingDraft: _draft, ...safe } = profile as T & {onboardingDraft?:unknown};
    return {
      ...safe,
      ...(profile.resumes ? {resumes: profile.resumes.map((r) => this.sanitizeResume(r))} : {}),
    } as T;
  }

  private sourceNarrativeLocale(
    contentLocale?: string | null,
    headline?: string | null,
    summary?: string | null,
  ): Locale | null {
    return effectiveSourceLocale(
      contentLocale,
      [headline, summary].filter(Boolean).join('\n'),
    );
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
    const resolved = resolveUgcContent(
      { headline: rest.headline ?? '' },
      rest.contentLocale,
      translations.map((row) => ({
        locale: row.locale,
        headline: row.headline ?? '',
        isMachine: row.isMachine,
      })),
      locale,
      rest.headline ?? '',
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
    const resolved = resolveUgcContent(
      { headline: rest.headline ?? '', summary: rest.summary ?? '' },
      rest.contentLocale,
      translations.map((row) => ({
        locale: row.locale,
        headline: row.headline ?? '',
        summary: row.summary ?? '',
        isMachine: row.isMachine,
      })),
      locale,
      [rest.headline, rest.summary].filter(Boolean).join('\n'),
    );

    let anyFallback = resolved.isFallback && Boolean(rest.headline?.trim() || rest.summary?.trim());

    const experiences = rest.experiences.map((exp) => {
      const { translations: expT = [], ...e } = exp;
      const r = resolveUgcContent(
        { title: e.title, description: e.description ?? '' },
        source,
        expT.map((row) => ({
          locale: row.locale,
          title: row.title,
          description: row.description ?? '',
          isMachine: row.isMachine,
        })),
        locale,
        `${e.title}\n${e.description ?? ''}`,
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
      const r = resolveUgcContent(
        { field: e.field },
        source,
        eduT.map((row) => ({
          locale: row.locale,
          field: row.field ?? '',
          isMachine: row.isMachine,
        })),
        locale,
        e.field,
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
      canMachineTranslate: this.translation.enabled && anyFallback && Boolean(source),
    };
  }

  async myProfile(user: AuthUser) {
    const profile = await this.getProfileForUser(user.id);
    return { ...this.sanitizeProfileResumes(profile), desiredSalaryMin: profile.desiredSalaryMin === null ? null : Number(profile.desiredSalaryMin) };
  }

  async updateProfile(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    let cityId: string | null | undefined = undefined;
    let residenceCountryId = data.residenceCountryId as string | null | undefined;
    if (data.citySlug !== undefined || data.residenceCountryId !== undefined) {
      const location = await resolveJobLocation(this.prisma, { citySlug: data.citySlug, countryId: data.residenceCountryId }, { cityId: profile.cityId, countryId: profile.residenceCountryId });
      cityId = location.cityId;
      residenceCountryId = location.countryId;
    }

    let phone: string | null | undefined = undefined;
    if (data.phone !== undefined) {
      const raw = String(data.phone || '').trim();
      if (!raw) {
        if (profile.onboardingStatus !== 'IN_PROGRESS') {
          throw new BadRequestException('PHONE_REQUIRED');
        }
        phone = null;
      } else {
        phone = normalizeE164Phone(raw);
        if (!phone) throw new BadRequestException('PHONE_INVALID');
        const taken = await this.prisma.employeeProfile.findFirst({
          where: { phone, NOT: { id: profile.id } },
          select: { id: true },
        });
        if (taken) {
          throw new ConflictException('PHONE_DUPLICATE');
        }
      }
    }

    const countryIds = [...new Set([...(data.preferredCountryIds as string[] || []), ...(data.residenceCountryId ? [String(data.residenceCountryId)] : [])])];
    if (countryIds.length && await this.prisma.country.count({where:{id:{in:countryIds},isActive:true,archivedAt:null}}) !== countryIds.length) throw new BadRequestException('Select countries from the available list');
    if (data.desiredSalaryCurrency && !Intl.supportedValuesOf('currency').includes(String(data.desiredSalaryCurrency))) throw new BadRequestException('Invalid currency');
    const roleInput = data.desiredPositions === undefined ? (data.desiredPosition === undefined ? undefined : [String(data.desiredPosition)].filter(Boolean)) : data.desiredPositions as string[];
    const roles = roleInput === undefined ? undefined : await canonicalRoleNames(this.prisma, roleInput);
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
          ...(roles ? { desiredPositions: roles, desiredPosition: roles[0] || null } : {}),
          desiredSalaryCurrency: data.desiredSalaryCurrency as string | undefined,
          desiredSalaryPeriod: data.desiredSalaryPeriod as never,
          salaryNegotiable: data.salaryNegotiable as boolean | undefined,
          residenceCountryId,
          noExperience: data.noExperience as boolean | undefined,
          ...(data.preferredCountryIds ? { preferredCountries: { set: (data.preferredCountryIds as string[]).map(id=>({id})) } } : {}),
        },
        include: this.profileInclude,
      });
    } catch (e: unknown) {
      const target = String((e as { meta?: { target?: unknown } })?.meta?.target || '').toLowerCase();
      if ((e as { code?: string })?.code === 'P2002' && (target.includes('phone') || data.phone !== undefined)) {
        throw new ConflictException('PHONE_DUPLICATE');
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
        levelSource: opts.level ? 'USER_CONFIRMED' : 'LEGACY_UNKNOWN',
      },
      update: { ...(opts.level ? { level: opts.level as never, levelSource:'USER_CONFIRMED' } : {}) },
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
      data: { level: level as never, levelSource:'USER_CONFIRMED' },
      include: { skill: true },
    });
  }

  async addExperience(user: AuthUser, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    const { cityId, countryId } = await resolveJobLocation(this.prisma, data);
    const dates = careerDates(data as never, true);
    return this.prisma.$transaction(async tx => {
    await tx.employeeProfile.update({ where: { id: profile.id }, data: { noExperience: false } });
    return tx.workExperience.create({
      data: {
        profileId: profile.id,
        companyName: String(data.companyName),
        countryId,
        title: String(data.title),
        description: (data.description as string) || null,
        cityId,
        locationNote: (data.locationNote as string) || null,
        startDate: dates.startDate!,
        endDate: dates.endDate,
        isCurrent: Boolean(data.isCurrent),
      },
      include: { city: { include: { province: { include: { country: true } } } } },
    });
    });
  }

  private async resolveExperienceCityId(citySlug?: unknown) {
    if (!citySlug) return null;
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

    const { cityId, countryId } = await resolveJobLocation(this.prisma, data, existing);
    const dates = careerDates({ startDate: existing.startDate, endDate: existing.endDate, isCurrent: existing.isCurrent, ...data } as never, true);

    return this.prisma.workExperience.update({
      where: { id },
      data: {
        ...(data.companyName !== undefined ? { companyName: String(data.companyName) } : {}),
        ...(data.title !== undefined ? { title: String(data.title) } : {}),
        ...(data.description !== undefined
          ? { description: (data.description as string) || null }
          : {}),
        ...(cityId !== undefined ? { cityId } : {}),
        countryId,
        ...(data.locationNote !== undefined
          ? { locationNote: (data.locationNote as string) || null }
          : {}),
        startDate: dates.startDate!,
        endDate: dates.endDate,
        ...(data.isCurrent !== undefined ? { isCurrent: Boolean(data.isCurrent) } : {}),
      },
      include: { city: { include: { province: { include: { country: true } } } } },
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
    const dates = careerDates(data as never);
    return this.prisma.education.create({
      data: {
        profileId: profile.id,
        school: String(data.school),
        degree: (data.degree as never) || null,
        field: (data.field as string) || null,
        ...dates,
      },
    });
  }

  async updateEducation(user: AuthUser, id: string, data: Record<string, unknown>) {
    const profile = await this.getProfileForUser(user.id);
    const existing = await this.prisma.education.findFirst({
      where: { id, profileId: profile.id },
    });
    if (!existing) throw new NotFoundException('Education not found');
    const dates = careerDates({ startDate: existing.startDate, endDate: existing.endDate, ...data } as never);
    return this.prisma.education.update({
      where: { id },
      data: {
        ...(data.school !== undefined ? { school: String(data.school) } : {}),
        ...(data.degree !== undefined ? { degree: (data.degree as never) || null } : {}),
        ...(data.field !== undefined ? { field: (data.field as string) || null } : {}),
        ...dates,
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

  private async assertResumeQuota(profileId: string, db: Prisma.TransactionClient = this.prisma) {
    const count = await db.resume.count({
      where: { profileId, deletedAt: null },
    });
    if (count >= MAX_RESUMES_PER_PROFILE) {
      throw new BadRequestException(
        `Resume limit reached (${MAX_RESUMES_PER_PROFILE}). Delete an old resume first.`,
      );
    }
  }

  private async insertLibraryResume(data: Prisma.ResumeUncheckedCreateInput) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${data.profileId} FOR UPDATE`);
      await this.assertResumeQuota(data.profileId, tx);
      const primary = await tx.resume.findFirst({ where: { profileId: data.profileId, deletedAt: null, isPrimary: true }, select: { id: true } });
      const makePrimary = Boolean(data.isPrimary) || !primary;
      if (makePrimary) await tx.resume.updateMany({ where: { profileId: data.profileId }, data: { isPrimary: false } });
      return tx.resume.create({ data: { ...data, isPrimary: makePrimary }, include: resumeTargetTitleInclude });
    });
  }

  private async updateLibraryResume(profileId: string, resumeId: string, data: Prisma.ResumeUncheckedUpdateInput, expectedUpdatedAt?: Date) {
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profileId} FOR UPDATE`);
      const owned = await tx.resume.findFirst({ where: { id: resumeId, profileId, deletedAt: null } });
      if (!owned) throw new NotFoundException('Resume not found');
      if (expectedUpdatedAt && owned.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictException('CV changed while exporting; refresh and export again');
      if (data.isPrimary === true) await tx.resume.updateMany({ where: { profileId }, data: { isPrimary: false } });
      if (data.isPrimary === false && owned.isPrimary) {
        const next = await tx.resume.findFirst({ where: { profileId, deletedAt: null, NOT: { id: resumeId } }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
        if (next) await tx.resume.update({ where: { id: next.id }, data: { isPrimary: true } });
        else data = { ...data, isPrimary: true };
      }
      const updated = await tx.resume.update({ where: { id: resumeId }, data, include: resumeTargetTitleInclude });
      return { updated, previousKey: owned.fileKey };
    });
    if (typeof data.fileKey === 'string' && result.previousKey && result.previousKey !== data.fileKey) await this.deleteStorageKeyIfOrphan(result.previousKey);
    return result.updated;
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
    const created = await this.insertLibraryResume({
        profileId: profile.id,
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary ?? false,
        targetJobTitleId,
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
    const touchRole = data.jobTitle !== undefined || data.jobTitleSlug !== undefined;
    const targetJobTitleId = touchRole
      ? await this.resolveTargetJobTitleId(data)
      : undefined;
    const updated = await this.updateLibraryResume(profile.id, resumeId, {
        title: data.title,
        content: data.content,
        isPrimary: data.isPrimary,
        ...(touchRole ? { targetJobTitleId } : {}),
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
    const owner = await this.prisma.resume.findUnique({ where: { id: resumeId }, select: { profileId: true } });
    if (!owner) return { purged: false };
    const removed = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${owner.profileId} FOR UPDATE`);
      const resume = await tx.resume.findUnique({ where: { id: resumeId }, include: { _count: { select: { applications: true } } } });
      if (!resume?.deletedAt || resume._count.applications > 0) return null;
      await tx.resume.delete({ where: { id: resumeId } });
      return { fileKey: resume.fileKey };
    });
    if (!removed) return { purged: false };
    await this.deleteStorageKeyIfOrphan(removed.fileKey);
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

  private async ensurePrimaryResume(profileId: string, db: Prisma.TransactionClient = this.prisma) {
    const primary = await db.resume.findFirst({
      where: { profileId, deletedAt: null, isPrimary: true },
      select: { id: true },
    });
    if (primary) return;
    const next = await db.resume.findFirst({
      where: { profileId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (next) await db.resume.update({ where: { id: next.id }, data: { isPrimary: true } });
  }

  async deleteResume(user: AuthUser, resumeId: string) {
    const profile = await this.getProfileForUser(user.id);
    const removed = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
      const resume = await tx.resume.findFirst({ where: { id: resumeId, profileId: profile.id, deletedAt: null } });
      if (!resume) throw new NotFoundException('Resume not found');
      const used = await tx.application.count({ where: { resumeId } });
      if (used) await tx.resume.update({ where: { id: resumeId }, data: { deletedAt: new Date(), isPrimary: false, parseGeneration: { increment: 1 }, parseStatus: 'NONE', parseStartedAt: null } });
      else await tx.resume.delete({ where: { id: resumeId } });
      await this.ensurePrimaryResume(profile.id, tx);
      return { key: used ? null : resume.fileKey, softDeleted: Boolean(used), hardDeleted: !used };
    });
    if (removed.key) await this.deleteStorageKeyIfOrphan(removed.key);
    return { ok: true, softDeleted: removed.softDeleted, hardDeleted: removed.hardDeleted,
      ...(removed.softDeleted ? { message: 'Removed from your library. The file stays available for applications already submitted.' } : {}) };
  }

  async restoreResume(user: AuthUser, resumeId: string) {
    const profile = await this.getProfileForUser(user.id);
    const resume = await this.prisma.resume.findFirst({
      where: { id: resumeId, profileId: profile.id },
    });
    if (!resume) throw new NotFoundException('Resume not found');
    return this.prisma.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
    const current = await tx.resume.findFirst({ where: { id: resumeId, profileId: profile.id } });
    if (!current) throw new NotFoundException('Resume not found');
    if (!current.deletedAt) return this.sanitizeResume(current);
    await this.assertResumeQuota(profile.id, tx);
    await tx.resume.update({
      where: { id: resumeId },
      data: { deletedAt: null },
    });
    await this.ensurePrimaryResume(profile.id, tx);
    return this.sanitizeResume(
      await tx.resume.findUniqueOrThrow({ where: { id: resumeId } }),
    );
    });
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
        city: { include: { province: { include: { country: true } } } },
        residenceCountry: true,
        skills: { include: { skill: true } },
        experiences: { include: { country: true, city: { include: { province: { include: { country: true } } } } }, orderBy: { startDate: 'desc' } },
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
    if (resumeId && !resume) throw new NotFoundException('Resume not found');

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
      city: full.city?.name || full.residenceCountry?.name || null,
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
        location: e.city?.name || e.country?.name || e.locationNote || null,
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
            targetJobTitle: profile.resumes.find((item) => item.id === resume.id)?.targetJobTitle ?? null,
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
    const created = await this.insertLibraryResume({
        profileId: profile.id,
        title: data.title,
        templateKey: data.templateKey || 'classic',
        themeAccent: data.themeAccent ?? null,
        inclusion: (normalizeResumeInclusion(data.inclusion as never) ||
          DEFAULT_RESUME_INCLUSION) as never,
        isPrimary: makePrimary,
        targetJobTitleId,
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
    const touchRole = data.jobTitle !== undefined || data.jobTitleSlug !== undefined;
    const targetJobTitleId = touchRole
      ? await this.resolveTargetJobTitleId(data)
      : undefined;
    const updated = await this.updateLibraryResume(resume.profileId, resumeId, {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.templateKey !== undefined ? { templateKey: data.templateKey } : {}),
        ...(data.themeAccent !== undefined ? { themeAccent: data.themeAccent } : {}),
        ...(data.inclusion !== undefined
          ? { inclusion: normalizeResumeInclusion(data.inclusion as never) as never }
          : {}),
        ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
        ...(touchRole ? { targetJobTitleId } : {}),
    });
    return this.sanitizeResume(updated);
  }

  async exportResumePdf(user: AuthUser, resumeId: string, locale: Locale) {
    const { resume: owned } = await this.ownedResume(user.id, resumeId);
    const previousKey = owned.fileKey;
    const payload = await this.getResumeDocument(user, resumeId);
    if (!payload.resume) throw new NotFoundException('Resume not found');
    const { buildResumePdfBuffer } = await import('./resume-pdf');
    let buffer: Buffer;
    try {
      buffer = await buildResumePdfBuffer({
        locale,
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
    const updated = await this.updateLibraryResume(owned.profileId, resumeId, {
        fileKey: uploaded.key,
        fileUrl: null,
        builderMeta: {
          lastExportAt: new Date().toISOString(),
          checklistScore: payload.checklist.score,
        } as never,
        parseGeneration: { increment: 1 },
        parseStatus: 'NONE',
        parseStartedAt: null,
        parseError: null,
        parsedAt: null,
        parsedData: Prisma.DbNull,
        content: null,
    }, owned.updatedAt).catch(async error => { await this.deleteStorageKeyIfOrphan(uploaded.key); throw error; });
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

  async downloadResume(user: AuthUser, resumeId: string, companyId?:string) {
    const resume = await this.prisma.resume.findUnique({
      where: { id: resumeId },
      include: {
        profile: {
          select: {
            id: true,
            userId: true,
            user: { select: { isBanned: true, anonymizedAt: true } },
          },
        },
      },
    });
    if (!resume) throw new NotFoundException('Resume not found');
    if (resume.profile.user.isBanned || resume.profile.user.anonymizedAt) {
      throw new NotFoundException('Resume not available');
    }

    const isOwner = resume.profile.userId === user.id;
    // Soft-deleted library items stay downloadable for recruiters (and restore for owner).
    let allowed = isOwner || user.role === 'SUPER_ADMIN';
    let fileKey = resume.fileKey;
    let title = resume.title;

    // Recruiter may download only if the candidate applied to their company
    if (!allowed && user.role === 'RECRUITER') {
      const companyIds = this.candidateAccess ? [await this.candidateAccess!.context(user,companyId)] : await this.activeCompanyIds(user);
      if (companyIds.length) {
        const applied = await this.prisma.application.findFirst({
          where: {
            profileId: resume.profile.id,
            resumeId,
            jobPost: { companyId: { in: companyIds } },
          },
          select: { id: true, resumeSnapshot: true },
          orderBy: { createdAt: 'desc' },
        });
        allowed = Boolean(applied);
        const submitted = submittedResume(applied?.resumeSnapshot, { fileKey, title });
        fileKey = submitted.fileKey;
        title = submitted.title ?? 'Resume';
      }
    }

    if (!allowed) throw new ForbiddenException('Not allowed to download this resume');
    if (!fileKey) throw new NotFoundException('No file attached to this resume');

    const url = await this.storage.getPresignedGetUrl(fileKey, 900);
    return { url, expiresIn: 900, title, softDeleted: Boolean(resume.deletedAt) };
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

    const updated = await this.updateLibraryResume(profile.id, resume.id, {
        fileKey: uploaded.key,
        fileUrl: null,
        parsedData: Prisma.DbNull,
        content: null,
        parseGeneration: { increment: 1 },
        parseStatus: 'NONE',
        parseStartedAt: null,
        parseError: null,
        parsedAt: null,
    }).catch(async error => { await this.deleteStorageKeyIfOrphan(uploaded.key); throw error; });

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

    const shouldParse = Boolean(meta?.parse);
    const resume = await this.insertLibraryResume({
      profileId: profile.id, title: resolvedTitle, fileKey: uploaded.key, fileUrl: null,
      isPrimary: true, parseStatus: shouldParse ? 'PENDING' : 'NONE', targetJobTitleId,
    }).catch(async error => { await this.deleteStorageKeyIfOrphan(uploaded.key); throw error; });

    if (shouldParse) {
      await this.cvParse.enqueue(resume.id);
    }

    return {
      ...this.sanitizeResume(resume),
      parseStatus: resume.parseStatus,
      needsReview: false,
    };
  }

  async retryCvParse(user: AuthUser, resumeId: string) {
    const { resume } = await this.ownedResume(user.id,resumeId);
    if (!resume.fileKey) throw new BadRequestException('Upload a CV first');
    const leaseStart = resume.parseStartedAt ?? resume.updatedAt;
    if (['PENDING','PROCESSING'].includes(resume.parseStatus) && Date.now()-leaseStart.getTime()<210000) return this.getResumeParseStatus(user,resumeId);
    await this.cvParse.enqueue(resumeId);
    return this.getResumeParseStatus(user,resumeId);
  }

  async getResumeParseStatus(user: AuthUser, resumeId: string) {
    const { resume } = await this.ownedResume(user.id, resumeId);
    return {
      id: resume.id,
      parseStatus: resume.parseStatus,
      parseError: resume.parseError,
      parseGeneration: resume.parseGeneration,
      parsedAt: resume.parsedAt,
      parsedData: resume.parsedData,
      needsReview: resume.parseStatus === 'READY' && Boolean(resume.parsedData),
    };
  }

  async importParsedResume(user: AuthUser, resumeId: string, draft: ResumeImportInput, expectedGeneration: number, tx?: Prisma.TransactionClient): Promise<any> {
    if (!tx) return this.prisma.$transaction(client => this.importParsedResume(user, resumeId, draft, expectedGeneration, client), { timeout: 30000 });
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE "userId" = ${user.id} FOR UPDATE`);
    // Replacement, retry and parsing completion lock this row too. The version
    // check must stay valid until all selected records have committed.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Resume" WHERE id = ${resumeId} FOR UPDATE`);
    const profile = await tx.employeeProfile.findUniqueOrThrow({ where: { userId: user.id }, include: this.profileInclude });
    const resume = await tx.resume.findFirst({ where: { id: resumeId, profileId: profile.id, deletedAt: null } });
    if (!resume || resume.parseStatus !== 'READY') throw new BadRequestException('CV is not ready for import');
    if (resume.parseGeneration !== expectedGeneration) throw new ConflictException('CV changed; read it again before importing');
    for (const experience of draft.experiences) careerDates(experience, true);
    for (const education of draft.educations) careerDates(education);
    if (draft.languages.some(language => !language.level)) throw new BadRequestException('Choose a level for each language selected for import');
    const importCountryIds = [...new Set(draft.experiences.flatMap(e=>e.countryId ? [e.countryId] : []))];
    if(importCountryIds.length && await tx.country.count({where:{id:{in:importCountryIds},isActive:true,archivedAt:null}})!==importCountryIds.length) throw new BadRequestException('Select countries from the available list');
    const parsed = resume.parsedData as ParsedCvData | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new BadRequestException('No parsed CV data on this resume - upload a CV first');
    }

    const headline = draft.headline?.trim();
    const summary = draft.summary?.trim();
    const replaceExisting = Boolean(draft.replaceExisting);

    const kept = pickFilledProfileFields(
      {
        headline: profile.headline ?? '',
        summary: profile.summary ?? '',
      },
      { headline, summary },
      replaceExisting,
    );

    const profilePatch: Record<string, unknown> = {};
    if (kept.headline) profilePatch.headline = kept.headline;
    if (kept.summary) profilePatch.summary = kept.summary;
    if (Object.keys(profilePatch).length) {
      if (profilePatch.headline || profilePatch.summary) {
        profilePatch.contentLocale = this.narrativeLocale(
          (profilePatch.headline as string) ?? profile.headline,
          (profilePatch.summary as string) ?? profile.summary,
        );
      }
      await tx.employeeProfile.update({
        where: { id: profile.id },
        data: profilePatch,
      });
    }

    const imported = {
      skills: 0,
      experiences: 0,
      educations: 0,
      languages: 0,
      skippedSkills: 0,
      skippedPhoneTaken: false,
    };

    const seenExperiences = new Set(
      (profile.experiences || []).map((row) =>
        experienceImportKey(row.title, row.companyName, row.startDate),
      ),
    );
    const seenEducations = new Set(
      (profile.educations || []).map((row) =>
        educationImportKey(row.school, row.degree, row.startDate),
      ),
    );

    for (const name of draft.skills || []) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      try {
        const { skill } = await resolveSkill(tx, { name: trimmed, allowCreate: true });
        const existing = await tx.profileSkill.findUnique({ where: { profileId_skillId: { profileId: profile.id, skillId: skill.id } } });
        await tx.profileSkill.upsert({
          where: { profileId_skillId: { profileId: profile.id, skillId: skill.id } },
          create: { profileId: profile.id, skillId: skill.id, level: 'INTERMEDIATE', levelSource:'CV_DEFAULT' },
          update: {},
        });
        if (!existing) imported.skills += 1;
      } catch (err) {
        // One reviewed label must not abort the rest of the import.
        if (err instanceof BadRequestException) {
          imported.skippedSkills += 1;
          continue;
        }
        throw err;
      }
    }

    for (const exp of draft.experiences || []) {
      if (!exp.title.trim() || !exp.companyName.trim()) continue;
      const { startDate, endDate } = careerDates(exp, true);
      const key = experienceImportKey(exp.title, exp.companyName, exp.startDate);
      if (seenExperiences.has(key)) continue;
      seenExperiences.add(key);
      await tx.workExperience.create({
        data: {
          profileId: profile.id,
          title: exp.title.trim(),
          companyName: exp.companyName.trim(),
          countryId: exp.countryId,
          description: exp.description?.trim() || undefined,
          startDate: startDate!,
          endDate,
          isCurrent: Boolean(exp.isCurrent),
        },
      });
      imported.experiences += 1;
    }

    for (const edu of draft.educations || []) {
      if (!edu.school.trim()) continue;
      const key = educationImportKey(edu.school, edu.degree, edu.startDate);
      if (seenEducations.has(key)) continue;
      seenEducations.add(key);
      await tx.education.create({
        data: {
          profileId: profile.id,
          school: edu.school.trim(),
          degree: edu.degree,
          field: edu.field?.trim() || undefined,
          startDate: resumeStartDate(edu.startDate),
          endDate: resumeStartDate(edu.endDate),
        },
      });
      imported.educations += 1;
    }

    for (const lang of draft.languages || []) {
      if (!lang.name.trim()) continue;
      const language = lang.code
        ? await tx.language.findUnique({ where: { code: lang.code } })
        : await tx.language.findFirst({ where: { OR: [
          ...(['name', 'nameId', 'nameRu', 'nameUz'] as const).map(field => ({ [field]: { equals: lang.name.trim(), mode: 'insensitive' as const } })),
          { aliases: { some: { alias: { equals: lang.name.trim(), mode: 'insensitive' } } } },
        ] } });
      if (!language || language.archivedAt) throw new BadRequestException('Select a language from the available catalog');
      const existing = await tx.profileLanguage.findUnique({ where: { profileId_languageId: { profileId: profile.id, languageId: language.id } } });
      // Merging a CV must not silently downgrade a previously confirmed level.
      if (existing && !replaceExisting) continue;
      await tx.profileLanguage.upsert({
        where: {
          profileId_languageId: { profileId: profile.id, languageId: language.id },
        },
        create: {
          profileId: profile.id,
          languageId: language.id,
          level: lang.level as never,
        },
        update: { level: lang.level as never },
      });
      if (!existing) imported.languages += 1;
    }

    if (imported.experiences) await tx.employeeProfile.update({ where: { id: profile.id }, data: { noExperience: false } });
    const refreshed = await tx.employeeProfile.findUniqueOrThrow({where:{userId:user.id},include:this.profileInclude});
    return { ok: true, imported, profile: this.sanitizeProfileResumes(refreshed) };
  }

  private profileTitleTexts(p: {
    desiredPositions?: string[];
    desiredPosition?: string | null;
    headline?: string | null;
    experiences?: Array<{ title?: string | null }>;
  }): string[] {
    return profileRoleTexts(p);
  }

  private profileMatchesTitleKeys(
    p: {
      desiredPositions?: string[];
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
      companyId?:string;
      q?: string;
      city?: string;
      country?: string;
      skills?: string;
      skillMode?: 'AND' | 'OR';
      jobTitle?: string;
      degree?: string;
      languages?: string;
      experienceYearsMin?: number;
      experienceYearsMax?: number;
      hasCertification?: boolean;
      matchJobId?: string;
      excludeApplied?: boolean;
      sort?: 'relevance' | 'newest' | 'match';
      page?: number;
      limit?: number;
      locale?: Locale;
    },
  ) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    if(this.candidateAccess) {
      const job=query.matchJobId?await this.prisma.jobPost.findUnique({where:{id:query.matchJobId},select:{companyId:true}}):null;
      const context=await this.candidateAccess!.context(user,query.companyId||job?.companyId);
      if(job&&job.companyId!==context)throw new ForbiddenException('Job and company context differ');
    }
    if (query.matchJobId) {
      const matchJob = await this.prisma.jobPost.findUnique({
        where: { id: query.matchJobId },
        select: { id: true, companyId: true, status: true, publishedAt: true },
      });
      if (!matchJob) throw new NotFoundException('Match job not found');
      if (matchJob.status === 'DRAFT' || !matchJob.publishedAt) throw new BadRequestException('Publish this job before ranking candidates');
      if (user.role !== 'SUPER_ADMIN') {
        await this.companies.assertMember(user, matchJob.companyId);
      }
    }

    const activeCompanyIds = await this.activeCompanyIds(user);
    const limited = user.role !== 'SUPER_ADMIN' && activeCompanyIds.length === 0;

    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const locale = query.locale ?? DEFAULT_LOCALE;
    const and: Prisma.EmployeeProfileWhereInput[] = [
      { visibility: { in: ['PUBLIC', 'TO_REGISTERED_RECRUITERS'] } },
      { user: { isBanned: false, anonymizedAt: null } },
    ];
    if (query.excludeApplied && query.matchJobId) and.push({ applications: { none: { jobPostId: query.matchJobId } } });

    const citySlugs = (query.city || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (citySlugs.length) and.push({ city: { slug: { in: citySlugs } } });
    const countrySlugs = (query.country || '').split(',').map(value => value.trim()).filter(Boolean);
    if (countrySlugs.length) and.push({ OR: [
      { residenceCountry: { slug: { in: countrySlugs } } },
      { residenceCountryId: null, city: { province: { country: { slug: { in: countrySlugs } } } } },
    ] });

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
      const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
      const secondaryRoles = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE EXISTS (SELECT 1 FROM unnest("desiredPositions") AS role(label) WHERE role.label ILIKE ${pattern})`);
      and.push({
        OR: [
          { headline: { contains: term, mode: 'insensitive' } },
          { summary: { contains: term, mode: 'insensitive' } },
          { desiredPosition: { contains: term, mode: 'insensitive' } },
          { id: { in: secondaryRoles.map(profile => profile.id) } },
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
        where: { slug: { in: titleSlugs }, ...ACTIVE_CATALOG },
        include: { aliases: true },
      });
      for (const t of catalog) {
        if (t.normalizedKey) titleKeySet.add(t.normalizedKey);
        const keyFromName = normalizeJobTitleKey(t.name);
        if (keyFromName) titleKeySet.add(keyFromName);
        for (const label of [t.nameRu, t.nameUz, t.nameId]) if (label) titleKeySet.add(normalizeJobTitleKey(label));
        for (const alias of t.aliases) {
          const key = normalizeJobTitleKey(alias.alias);
          if (key) titleKeySet.add(key);
        }
      }
      const terms = [
        ...new Set(
          catalog.flatMap((t) => [t.name, t.nameId, t.nameUz, t.nameRu, ...t.aliases.map((a) => a.alias)].filter((label): label is string => Boolean(label))),
        ),
      ];
      if (terms.length) {
        and.push({
          OR: terms.flatMap((term) => [
            { desiredPositions: { has: term } },
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
    /** Scan in batches; an older high-match employee must not disappear at an arbitrary cap. */
    const SCAN_BATCH = 100;
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
      skills: { include: { skill: { include: { aliases: { select: { aliasKey: true } } } } } },
      city: { include: { province: { include: { country: true } } } },
      residenceCountry: true,
      experiences: true,
      educations: true,
      languages: { include: { language: true } },
      certifications: true,
      translations: { select: { locale: true, headline: true, isMachine: true } },
      _count: { select: { certifications: true } },
      preferredCountries: true,
      // Project only availability into the list; never expose storage keys.
      databaseResume: { select: { profileId: true, fileKey: true, deletedAt: true } },
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
        nameId?: string | null;
        archivedAt?: Date | null;
      } | null;
      skills: Array<{
        skill: {
          slug: string;
          name: string;
          nameUz?: string | null;
          nameRu?: string | null;
          nameId?: string | null;
          archivedAt?: Date | null;
        };
      }>;
      desiredPosition?: string | null;
      desiredPositions?: string[];
      headline?: string | null;
      experiences?: Array<{ title?: string | null }>;
    }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapProfile = (p: any) => {
      const years = this.matching.totalExperienceYears(p.experiences);
      // Translate only after matching. A translated headline must not change
      // the score or the role-family filter for the same employee.
      const { phone: _phone, onboardingDraft: _draft, databaseResume, ...publicProfile } = p;
      return {
        ...publicProfile,
        canReadCv: !limited && Boolean(p.databaseCvEnabled && databaseResume?.fileKey &&
          !databaseResume.deletedAt && databaseResume.profileId === p.id),
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
        const breakdowns = await this.matching.scoreProfilesAgainstJob(pageItems, query.matchJobId);
        pageItems = pageItems.map((profile, index) => ({ ...profile, matchScore: breakdowns[index].total, matchBreakdown: breakdowns[index] }));
      }

      facetSource = await this.prisma.employeeProfile.findMany({
        where,
        select: {
          city: {
            select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
          },
          skills: {
            select: {
              skill: {
                select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, archivedAt: true },
              },
            },
          },
          desiredPosition: true,
          desiredPositions: true,
          headline: true,
          experiences: { select: { title: true }, take: 5, orderBy: { startDate: 'desc' } },
        },
        take: 1000,
        orderBy: { updatedAt: 'desc' },
      });
    } else {
      let cursor: string | undefined;
      let scored: ReturnType<typeof mapProfile>[] = [];
      while (true) {
        const batch = await this.prisma.employeeProfile.findMany({ where, include: candidateInclude,
          take: SCAN_BATCH, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        scored.push(...batch.map(mapProfile));
        if (batch.length < SCAN_BATCH) break;
        cursor = batch[batch.length - 1].id;
      }
      scored.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || a.id.localeCompare(b.id));

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
        const breakdowns = await this.matching.scoreProfilesAgainstJob(scored, query.matchJobId);
        scored = scored.map((profile, index) => ({ ...profile, matchScore: breakdowns[index].total, matchBreakdown: breakdowns[index] }));
        if (sort === 'match') scored.sort((a, b) => compareRecruiterMatches(a.matchBreakdown as RecruiterBreakdown,b.matchBreakdown as RecruiterBreakdown) || a.id.localeCompare(b.id));
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
      nameId?: string | null;
      count: number;
    };
    const cityFacets: Record<string, Facet> = {};
    const skillFacets: Record<string, Facet> = {};
    const titleFacets: Record<string, Facet> = {};

    const catalogTitles = await this.prisma.jobTitle.findMany({
      where: ACTIVE_CATALOG,
      select: { slug: true, name: true, nameUz: true, nameRu: true, nameId: true, normalizedKey: true },
    });
    const catalogByKey = new Map<
      string,
      { slug: string; name: string; nameUz?: string | null; nameRu?: string | null; nameId?: string | null }
    >();
    for (const t of catalogTitles) {
      const key = t.normalizedKey || normalizeJobTitleKey(t.name);
      if (key && !catalogByKey.has(key)) {
        catalogByKey.set(key, { slug: t.slug, name: t.name, nameUz: t.nameUz, nameRu: t.nameRu, nameId: t.nameId });
      }
    }

    // Archived entries stay on the candidate cards that use them but are not
    // offered as filter options.
    for (const p of facetSource) {
      if (p.city && !p.city.archivedAt) {
        const key = p.city.slug;
        cityFacets[key] = cityFacets[key]
          ? { ...cityFacets[key], count: cityFacets[key].count + 1 }
          : { slug: p.city.slug, name: p.city.name, nameUz: p.city.nameUz, nameRu: p.city.nameRu, nameId: p.city.nameId, count: 1 };
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
              nameRu: s.skill.nameRu, nameId: s.skill.nameId,
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
          : { slug: cat.slug, name: cat.name, nameUz: cat.nameUz, nameRu: cat.nameRu, nameId: cat.nameId, count: 1 };
      }
    }

    const presenceMap = await this.presence.getPresence(
      pageItems.map((p) => p.user?.id as string).filter(Boolean),
    );
    pageItems = pageItems.map((p) => ({
      ...this.resolveHeadlineForList(p, locale),
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
   * Contacts require an active company; private applicants retain their visibility exception.
   */
  private async contactAccessFor(user: AuthUser, profileId: string, companyId?:string) {
    const activeCompanyIds = await this.activeCompanyIds(user);
    let limited = user.role !== 'SUPER_ADMIN' && activeCompanyIds.length === 0;
    const companyIds = companyId?[companyId]:activeCompanyIds;

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

  private async activeCompanyIds(user: AuthUser) {
    const companyIds = [...new Set((user.memberships ?? []).map((membership) => membership.companyId))];
    if (!companyIds.length) return [];
    const companies = await this.prisma.company.findMany({
      where: { id: { in: companyIds }, isBanned: false, anonymizedAt: null },
      select: { id: true },
    });
    return companies.map((company) => company.id);
  }

  async getCandidateProfile(
    user: AuthUser,
    profileId: string,
    matchJobId?: string,
    locale: Locale = DEFAULT_LOCALE,
    companyId?: string,
  ) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    let scopedCompany:string|undefined;
    if(this.candidateAccess) {
      const job=matchJobId?await this.prisma.jobPost.findUnique({where:{id:matchJobId},select:{companyId:true}}):null;
      scopedCompany=await this.candidateAccess!.context(user,companyId||job?.companyId);
      if(job&&job.companyId!==scopedCompany)throw new ForbiddenException('Job and company context differ');
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      include: {
        residenceCountry: true,
        user: {
          select: { id: true, fullName: true, avatarUrl: true, locale: true },
        },
        skills: { include: { skill: true } },
        translations: {
          select: { locale: true, headline: true, summary: true, isMachine: true },
        },
        experiences: {
          include: {
            country: true,
            city: { include: { province: { include: { country: true } } } },
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
        // Candidate detail pages need display metadata only. Do not return private
        // CV contents, parsed text, storage URLs, or internal storage keys.
        resumes: {
          where: { isPrimary: true, deletedAt: null },
          take: 1,
          select: {
            id: true,
            title: true,
            fileKey: true,
            isPrimary: true,
            targetJobTitle: {
              select: { id: true, name: true, nameUz: true, nameRu: true, nameId: true, slug: true },
            },
          },
        },
        city: { include: { province: { include: { country: true } } } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not available');
    }

    const accountState = await this.prisma.user.findUnique({
      where: { id: profile.user.id },
      select: { isBanned: true, anonymizedAt: true },
    });
    if (!accountState || accountState.isBanned || accountState.anonymizedAt) {
      throw new NotFoundException('Profile not available');
    }

    const { limited, appliedToMyCompany } = await this.contactAccessFor(user, profileId,scopedCompany);

    if (profile.visibility === 'PRIVATE' && !appliedToMyCompany) {
      throw new NotFoundException('Profile not available');
    }

    const experienceYears = this.matching.totalExperienceYears(profile.experiences);

    let match: unknown = null;
    let applicationForJob: {
      id: string;
      resumeTitle: string | null;
      hasResumeFile: boolean;
      status: string;
      kanbanEnteredAt: Date | null;
      canAddToKanban: boolean;
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
      match = await this.matching.scoreProfileAgainstJob(profileId, matchJobId);

      const application = await this.prisma.application.findUnique({
        where: {
          jobPostId_profileId: { jobPostId: matchJobId, profileId },
        },
        include: { resume: { select: { title: true, fileKey: true } } },
      });
      if (application) {
        const submitted = submittedResume(application.resumeSnapshot);
        applicationForJob = {
          id: application.id,
          resumeTitle: submitted.title,
          hasResumeFile: Boolean(submitted.fileKey),
          status: application.status,
          kanbanEnteredAt: application.kanbanEnteredAt,
          canAddToKanban: !application.kanbanEnteredAt && !['WITHDRAWN','REJECTED','HIRED'].includes(application.status),
        };
      }
    }

    const localized = this.localizeCandidateProfile(profile, locale);
    const safe = this.sanitizeProfileResumes(localized);
    const candidateResumeIds = profile.resumes.map((resume) => resume.id);
    const companyIds = scopedCompany?[scopedCompany]:await this.activeCompanyIds(user);
    const downloadableResumeIds = new Set<string>();
    if (user.role === 'SUPER_ADMIN') {
      for (const resumeId of candidateResumeIds) downloadableResumeIds.add(resumeId);
    } else if (candidateResumeIds.length && companyIds.length) {
      const applications = await this.prisma.application.findMany({
        where: {
          profileId,
          resumeId: { in: candidateResumeIds },
          jobPost: { companyId: { in: companyIds } },
        },
        select: { resumeId: true },
      });
      for (const application of applications) {
        if (application.resumeId) downloadableResumeIds.add(application.resumeId);
      }
    }
    const resumes = (safe.resumes as Array<Record<string, unknown>> | undefined)?.map((resume) => ({
      ...resume,
      canDownload: resume.hasFile === true && downloadableResumeIds.has(String(resume.id)),
    }));
    return {
      ...safe,
      ...(resumes ? { resumes } : {}),
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
  async revealCandidateContact(user: AuthUser, profileId: string, companyId?: string) {
    if (user.role !== 'RECRUITER' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }

    if (this.candidateAccess) {
      const context = await this.candidateAccess!.context(user, companyId);
      const profile = await this.candidateAccess!.assertAccess(user, context, profileId, 'CONTACT');
      await this.assertRevealQuota(user);
      await this.prisma.auditLog.create({data:{actorId:user.id,action:'CANDIDATE_CONTACT_REVEAL',entityType:'EmployeeProfile',entityId:profileId,metadata:{companyId:context}}});
      return { email: profile.user.email, phone: profile.phone };
    }
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        phone: true,
        visibility: true,
        user: { select: { email: true, isBanned: true, anonymizedAt: true } },
      },
    });
    if (!profile) throw new NotFoundException('Profile not available');
    if (profile.user.isBanned || profile.user.anonymizedAt) {
      throw new NotFoundException('Profile not available');
    }

    const { limited, appliedToMyCompany } = await this.contactAccessFor(user, profileId);
    if (profile.visibility === 'PRIVATE' && !appliedToMyCompany) {
      throw new NotFoundException('Profile not available');
    }
    if (limited) {
      throw new ForbiddenException(
        'An active company membership is required to reveal contacts',
      );
    }

    await this.assertRevealQuota(user);

    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CANDIDATE_CONTACT_REVEAL',
        entityType: 'EmployeeProfile',
        entityId: profileId,
      },
    });

    return {
      email: profile.user.email ?? null,
      phone: profile.phone ?? null,
    };
  }

  /** Redis quota with a database audit-log fallback so outages do not open contact scraping. */
  private async assertRevealQuota(user: AuthUser) {
    const windowStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO "ContactRevealCounter" ("actorId","windowStart",count)
      VALUES (${user.id},${windowStart},1)
      ON CONFLICT ("actorId","windowStart") DO UPDATE SET count="ContactRevealCounter".count+1
      WHERE "ContactRevealCounter".count < ${REVEAL_LIMIT_PER_HOUR} RETURNING count`);
    if (!rows.length) throw new HttpException('Contact reveal limit reached for this hour. Try again later.', 429);
  }

  async saveJob(user: AuthUser, jobPostId: string) {
    const profile = await this.getProfileForUser(user.id);
    const job = await this.prisma.jobPost.findFirst({
      where: { id: jobPostId, ...liveJobWhere() },
      select: { id: true },
    });
    if (!job) throw new NotFoundException('Job not available');
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

  async listSaved(user: AuthUser, locale: Locale = DEFAULT_LOCALE) {
    const profile = await this.getProfileForUser(user.id);
    const rows = await this.prisma.savedJob.findMany({
      where: {
        profileId: profile.id,
        // Saved jobs are a reminder to apply later. Once an application exists,
        // the bookmark no longer belongs in this list (including withdrawn apps).
        jobPost: { applications: { none: { profileId: profile.id } } },
      },
      include: {
        jobPost: {
          include: {
            company: { select: { id: true, name: true, slug: true, logoUrl: true, isBanned: true, anonymizedAt: true } },
            city: { include: { province: { include: { country: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => {
      const job = row.jobPost;
      // Keep the bookmark removable without exposing unpublished edits or a
      // moderated company's information through the saved-jobs endpoint.
      if (job.status !== 'PUBLISHED' || job.company.isBanned || job.company.anonymizedAt) {
        return { ...row, jobPost: { id: job.id, title: '', status: 'CLOSED', company: null } };
      }
      const { isBanned: _isBanned, anonymizedAt: _anonymizedAt, ...company } = job.company;
      return { ...row, jobPost: maskAnonymousCompany({ ...job, company }, locale) };
    });
  }
}
