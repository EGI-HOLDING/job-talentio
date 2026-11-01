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
import { canonicalRoleNames } from "../common/title-resolve";
import { resolveJobLocation } from "../common/geo-selection";

const include = {
  user: { select: { fullName: true, email: true } },
  residenceCountry: true,
  preferredCountries: true,
  resumes: {
    where: { deletedAt: null },
    select: { id: true, title: true, parseStatus: true, parseGeneration: true,isPrimary:true,fileKey:true },
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
        resumes:profile.resumes.map(({fileKey,...resume})=>({...resume,hasFile:Boolean(fileKey)})),
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
    if(input.review || input.reviewState || input.manualExperiences?.length)throw new BadRequestException("CV information is processed automatically");
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
        const selected=draft.resumeId ? await db.resume.findFirst({where:{id:draft.resumeId,profileId:profile.id,deletedAt:null,fileKey:{not:null}}}) : await db.resume.findFirst({where:{profileId:profile.id,isPrimary:true,deletedAt:null,fileKey:{not:null}}});
        if(!selected)throw new BadRequestException('Upload a CV before completing onboarding');
        await db.resume.updateMany({where:{profileId:profile.id},data:{isPrimary:false}});
        await db.resume.update({where:{id:selected.id},data:{isPrimary:true}});
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
