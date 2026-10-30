import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  employeeOnboardingSchema,
  normalizeE164Phone,
  type EmployeeOnboardingInput,
} from "@job-talentio/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProfilesService } from "./profiles.service";
import { AuthUser } from "../common/auth.decorators";
import { experienceImportKey, resumeStartDate } from "./cv-import-merge";
import { canonicalRoleNames } from "../common/title-resolve";
import { resolveJobLocation } from "../common/geo-selection";
import { careerDates } from './career-dates';

const include = {
  user: { select: { fullName: true, email: true } },
  residenceCountry: true,
  preferredCountries: true,
  experiences: { include: { country: true } },
  resumes: {
    where: { deletedAt: null },
    select: { id: true, title: true, parseStatus: true, parseGeneration: true },
  },
} as const;
type Db = Prisma.TransactionClient;
@Injectable()
export class EmployeeOnboardingService {
  constructor(
    private prisma: PrismaService,
    private profiles: ProfilesService,
  ) {}
  private async profile(db: Db, userId: string) {
    return db.employeeProfile.findUniqueOrThrow({ where: { userId }, include });
  }
  private result(
    profile: Awaited<ReturnType<EmployeeOnboardingService["profile"]>>,
  ) {
    return {
      status: profile.onboardingStatus,
      step: profile.onboardingStep,
      completedAt: profile.onboardingCompletedAt,
      draft: profile.onboardingDraft || {},
      profile: {
        ...profile,
        desiredSalaryMin:
          profile.desiredSalaryMin === null
            ? null
            : Number(profile.desiredSalaryMin),
      },
    };
  }
  private rethrowPhoneConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      String(error.meta?.target || "").toLowerCase().includes("phone")
    )
      throw new ConflictException("PHONE_DUPLICATE");
    throw error;
  }
  async get(user: AuthUser) {
    return this.result(await this.profile(this.prisma, user.id));
  }
  private validate(
    profile: Awaited<ReturnType<EmployeeOnboardingService["profile"]>>,
    step: number,
  ) {
    if (step >= 2 && !profile.desiredPositions.length)
      throw new BadRequestException("Add at least one position");
    if (step >= 3 && !profile.preferredCountries.length)
      throw new BadRequestException("Select at least one country");
    if (
      step >= 5 &&
      (!profile.residenceCountryId || profile.user.fullName.trim().length < 2)
    )
      throw new BadRequestException(
        "Complete your name and country of residence",
      );
    if (step >= 5 && !normalizeE164Phone(profile.phone))
      throw new BadRequestException("PHONE_REQUIRED");
  }
  private async save(db: Db, user: AuthUser, input: EmployeeOnboardingInput) {
    const before = await this.profile(db, user.id);
    const draft = {
      ...((before.onboardingDraft || {}) as Record<string, unknown>),
    };
    for (const key of [
      "resumeId",
      "resumeGeneration",
      "review",
      "reviewState",
      "manualExperiences",
      "fullName",
      "desiredSalaryCurrency",
      "desiredSalaryPeriod",
      "phoneDraft",
    ] as const)
      if (input[key] !== undefined) draft[key] = input[key];
    if (input.resumeId) {
      const owned = await db.resume.findFirst({
        where: { id: input.resumeId, profileId: before.id, deletedAt: null },
      });
      if (!owned) throw new BadRequestException("CV not found");
      if (
        input.review &&
        (owned.parseStatus !== "READY" ||
          input.resumeGeneration !== owned.parseGeneration)
      )
        throw new BadRequestException(
          "CV changed; read it again before importing",
        );
    }
    if (input.review && !input.resumeId && !draft.resumeId)
      throw new BadRequestException("Select a CV before reviewing it");
    const ids = [
      ...new Set([
        ...(input.preferredCountryIds || []),
        ...(input.residenceCountryId ? [input.residenceCountryId] : []),
        ...(input.review?.experiences || []).flatMap((e) =>
          e.countryId ? [e.countryId] : [],
        ),
        ...(input.manualExperiences || []).flatMap((e) =>
          e.countryId ? [e.countryId] : [],
        ),
      ]),
    ];
    if (
      ids.length &&
      (await db.country.count({
        where: { id: { in: ids }, isActive: true, archivedAt: null },
      })) !== ids.length
    )
      throw new BadRequestException("Select countries from the available list");
    if (
      input.desiredSalaryCurrency &&
      !Intl.supportedValuesOf("currency").includes(input.desiredSalaryCurrency)
    )
      throw new BadRequestException("Invalid currency");
    const roles =
      input.desiredPositions === undefined
        ? undefined
        : await canonicalRoleNames(db, input.desiredPositions);
    let phone: string | null | undefined;
    if (input.phone !== undefined) {
      const rawPhone = input.phone.trim();
      if (!rawPhone) phone = null;
      else {
        phone = normalizeE164Phone(rawPhone);
        if (!phone) throw new BadRequestException("PHONE_INVALID");
        const taken = await db.employeeProfile.findFirst({
          where: { phone, NOT: { id: before.id } },
          select: { id: true },
        });
        if (taken) throw new ConflictException("PHONE_DUPLICATE");
      }
    }
    if (input.fullName && input.fullName.trim().length >= 2)
      await db.user.update({
        where: { id: user.id },
        data: { fullName: input.fullName.trim() },
      });
    const location = input.residenceCountryId === undefined ? undefined : await resolveJobLocation(db,
      { countryId: input.residenceCountryId }, { countryId: before.residenceCountryId, cityId: before.cityId });
    const profile = await db.employeeProfile.update({
      where: { id: before.id },
      data: {
        ...(roles
          ? { desiredPositions: roles, desiredPosition: roles[0] || null }
          : {}),
        ...(input.preferredCountryIds
          ? {
              preferredCountries: {
                set: [...new Set(input.preferredCountryIds)].map((id) => ({
                  id,
                })),
              },
            }
          : {}),
        residenceCountryId: input.residenceCountryId,
        cityId: location?.cityId,
        desiredSalaryMin: input.desiredSalaryMin,
        desiredSalaryCurrency: input.desiredSalaryCurrency,
        desiredSalaryPeriod: input.desiredSalaryPeriod,
        salaryNegotiable: input.salaryNegotiable,
        visibility: input.visibility,
        noExperience: input.noExperience,
        ...(phone !== undefined ? { phone } : {}),
        onboardingDraft: JSON.parse(
          JSON.stringify(draft),
        ) as Prisma.InputJsonValue,
        ...(before.onboardingStatus === "IN_PROGRESS"
          ? { onboardingStep: input.step }
          : {}),
      },
      include,
    });
    if (input.step && input.step > before.onboardingStep)
      this.validate(profile, input.step);
    return profile;
  }
  async patch(user: AuthUser, input: EmployeeOnboardingInput) {
    try {
      return await this.prisma.$transaction(async (db) => {
        await db.$queryRaw(
          Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE "userId"=${user.id} FOR UPDATE`,
        );
        const current = await this.profile(db, user.id);
        if (current.onboardingStatus !== "IN_PROGRESS")
          return this.result(current);
        return this.result(await this.save(db, user, input));
      });
    } catch (error) {
      this.rethrowPhoneConflict(error);
    }
  }
  async complete(user: AuthUser, input: EmployeeOnboardingInput) {
    try {
      return await this.prisma.$transaction(
      async (db) => {
        await db.$queryRaw(
          Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE "userId"=${user.id} FOR UPDATE`,
        );
        const before = await this.profile(db, user.id);
        if (before.onboardingStatus !== "IN_PROGRESS")
          return this.result(before);
        const profile = await this.save(db, user, input);
        this.validate(profile, 5);
        const draft = employeeOnboardingSchema.parse(
          profile.onboardingDraft || {},
        );
        if (draft.fullName !== undefined && draft.fullName.trim().length < 2)
          throw new BadRequestException("Complete your full name");
        if (draft.resumeId && draft.review) {
          const resume = await db.resume.findFirst({
            where: {
              id: draft.resumeId,
              profileId: profile.id,
              deletedAt: null,
            },
          });
          if (
            !resume ||
            resume.parseGeneration !== draft.resumeGeneration ||
            resume.parseStatus !== "READY"
          )
            throw new BadRequestException(
              "CV changed; read it again before importing",
            );
          for (const exp of profile.noExperience
            ? []
            : draft.review.experiences) {
            const start = resumeStartDate(exp.startDate),
              end = resumeStartDate(exp.endDate);
            if (!start || (!exp.isCurrent && end && end < start))
              throw new BadRequestException(
                "Check selected CV experience dates",
              );
          }
          await this.profiles.importParsedResume(
            user,
            draft.resumeId,
            {
              ...draft.review,
              experiences: profile.noExperience ? [] : draft.review.experiences,
            },
            draft.resumeGeneration!,
            db,
          );
        }
        if (!profile.noExperience) {
          const experiences = await db.workExperience.findMany({
            where: { profileId: profile.id },
          });
          const seen = new Set(
            experiences.map((e) =>
              experienceImportKey(e.title, e.companyName, e.startDate),
            ),
          );
          for (const exp of draft.manualExperiences || []) {
            const { startDate, endDate } = careerDates(exp, true);
            if (
              !startDate ||
              (!exp.isCurrent && endDate && endDate < startDate)
            )
              throw new BadRequestException("Check experience dates");
            const key = experienceImportKey(
              exp.title,
              exp.companyName,
              startDate,
            );
            if (seen.has(key)) continue;
            seen.add(key);
            await db.workExperience.create({
              data: {
                profileId: profile.id,
                title: exp.title,
                companyName: exp.companyName,
                description: exp.description,
                startDate,
                endDate: exp.isCurrent ? null : endDate,
                isCurrent: Boolean(exp.isCurrent),
                countryId: exp.countryId,
              },
            });
          }
        }
        await db.employeeProfile.update({
          where: { id: profile.id },
          data: {
            onboardingStatus: "COMPLETED",
            onboardingStep: 5,
            onboardingCompletedAt: new Date(),
            onboardingDraft: Prisma.DbNull,
          },
        });
        return this.result(await this.profile(db, user.id));
      },
      { timeout: 30000 },
      );
    } catch (error) {
      this.rethrowPhoneConflict(error);
    }
  }
}
