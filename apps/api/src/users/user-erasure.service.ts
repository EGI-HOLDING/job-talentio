import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  ANONYMIZED_DISPLAY_NAME,
  eraseBlockedByOpenCompany,
  type OpenOwnedCompany,
} from './erasure-guards';

const OPEN_APPLICATION_STATUSES = ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER'] as const;

@Injectable()
export class UserErasureService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async findOpenOwnedCompany(userId: string): Promise<OpenOwnedCompany | null> {
    const membership = await this.prisma.companyMember.findFirst({
      where: { userId, role: 'OWNER', company: { anonymizedAt: null } },
      select: {
        company: {
          select: {
            id: true,
            name: true,
            _count: { select: { members: true } },
          },
        },
      },
    });
    if (!membership) return null;
    return {
      companyId: membership.company.id,
      companyName: membership.company.name,
      memberCount: membership.company._count.members,
    };
  }

  assertCanErase(owned: OpenOwnedCompany | null) {
    const blocked = eraseBlockedByOpenCompany(owned);
    if (blocked) throw new ConflictException(blocked);
  }

  async erase(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarUrl: true, anonymizedAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.anonymizedAt) {
      throw new BadRequestException('Account already anonymized');
    }

    this.assertCanErase(await this.findOpenOwnedCompany(userId));

    const avatarKey = this.storage.keyFromPublicUrl(user.avatarUrl);
    const profile = await this.prisma.employeeProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const resumes = profile
      ? await this.prisma.resume.findMany({
          where: { profileId: profile.id },
          select: { id: true, fileKey: true },
        })
      : [];
    const cvVersions=profile?await this.prisma.resumeVersion.findMany({where:{OR:[{resumeId:{in:resumes.map(r=>r.id)}},{applications:{some:{profileId:profile.id}}}]},select:{id:true,fileKey:true}}):[];
    const taraSessions=profile?await this.prisma.aiScreeningSession.findMany({where:{profileId:profile.id},select:{id:true,coverFileKey:true,plans:{select:{id:true}},evaluation:{select:{pdfKey:true,revisions:{select:{snapshot:true}}}}}}):[];
    const taraSubjects=taraSessions.flatMap(s=>[s.id,...s.plans.map(p=>p.id)]).concat(cvVersions.map(v=>v.id));
    let taraKeys=taraSessions.flatMap(s=>[s.coverFileKey,s.evaluation?.pdfKey,...(s.evaluation?.revisions??[]).map(r=>(r.snapshot as {pdfKey?:string}).pdfKey)]).filter((key):key is string=>Boolean(key));
    const offerDocuments = profile
      ? await this.prisma.applicationOfferDocument.findMany({
          where: { packet: { application: { profileId: profile.id } } },
          select: { id: true, storageKey: true, packetId: true },
        })
      : [];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null,
          passwordHash: null,
          googleId: null,
          telegramId: null,
          phone: null,
          phoneVerifiedAt: null,
          avatarUrl: null,
          fullName: ANONYMIZED_DISPLAY_NAME,
          emailVerified: false,
          isBanned: true,
          anonymizedAt: new Date(),
        },
      });
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.emailChangeToken.deleteMany({ where: { userId } });
      await tx.telegramLinkToken.deleteMany({ where: { userId } });
      await tx.linkedInOAuthState.deleteMany({ where: { userId } });
      await tx.linkedInConnection.updateMany({ where: { userId }, data: { status: 'DISCONNECTED', autoShareEnabled: false, tokenCiphertext: null, tokenKeyVersion: null, tokenExpiresAt: null, subject: null, authorUrn: null, displayName: null, avatarUrl: null, generation: { increment: 1 }, disconnectedAt: new Date() } });
      await tx.linkedInSocialPost.updateMany({ where: { userId, status: { in: ['PENDING', 'RENDERING', 'UPLOADING'] } }, data: { status: 'CANCELLED', errorCode: 'ACCOUNT_REMOVED', errorSummary: 'The account was removed.' } });
      await tx.linkedInSocialPost.updateMany({ where: { userId, status: 'PUBLISHING' }, data: { status: 'UNKNOWN', retrySafe: false, errorCode: 'ACCOUNT_REMOVED_DURING_PUBLISH', errorSummary: 'The account was removed while a posting request was in flight.' } });
      // These records can contain saved searches, candidate names, and message
      // text. Preserve unrelated company history while removing this user's data.
      await tx.jobAlert.deleteMany({ where: { userId } });
      await tx.companyFollower.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      // Chat notifications delivered to the other participant include the
      // sender's name in their parameters and point back to this user.
      await tx.notification.deleteMany({
        where: { type: 'CHAT_MESSAGE', linkUrl: { contains: `peer=${userId}` } },
      });
      await tx.savedJob.deleteMany({ where: { profile: { userId } } });
      await tx.chatMessage.updateMany({
        where: { senderId: userId },
        data: { body: 'Message removed' },
      });
      await tx.bulkCampaignRecipient.updateMany({
        where: { userId },
        data: { candidateName: ANONYMIZED_DISPLAY_NAME, errorMessage: null },
      });
      await tx.companyMember.deleteMany({ where: { userId } });

      // Independent invitations and imported CV evidence must not survive a claimed account erasure.
      const linkedCandidates=await tx.recruitmentCandidate.findMany({where:{OR:[{application:{profile:{userId}}},{invitations:{some:{claimedUserId:userId}}},{messages:{some:{recipientUserId:userId}}}]},select:{id:true,fileKey:true}});
      const cvKeys=linkedCandidates.map(c=>c.fileKey).filter((key):key is string=>Boolean(key));
      const affected=await tx.recruitmentCandidate.findMany({where:{OR:[{id:{in:linkedCandidates.map(c=>c.id)}},{fileKey:{in:cvKeys}}]},select:{id:true,fileKey:true}});
      const candidateIds=affected.map(c=>c.id),invitations=await tx.screeningInvitation.findMany({where:{OR:[{claimedUserId:userId},{candidateId:{in:candidateIds}}]},select:{id:true}});
      const removedSubjects=[...candidateIds,...invitations.map(i=>i.id)];
      await tx.aiScreeningWork.updateMany({where:{subjectId:{in:removedSubjects}},data:{status:'CANCELLED',leaseOwner:null,leaseUntil:null,error:'ACCOUNT_ERASED'}});
      await tx.aiScreeningCall.updateMany({where:{subjectId:{in:removedSubjects}},data:{status:'ERASED',result:Prisma.DbNull,error:null}});
      await tx.screeningInvitation.updateMany({where:{id:{in:invitations.map(i=>i.id)}},data:{status:'CANCELLED',snapshot:{erased:true},recipientEmail:'erased@example.invalid',error:null}});
      const candidateMessages=await tx.candidateMessage.findMany({where:{OR:[{candidateId:{in:candidateIds}},{recipientUserId:userId}]},select:{id:true,messageId:true}});
      const candidateMessageIds=candidateMessages.map(m=>m.id);
      await tx.aiScreeningWork.updateMany({where:{kind:'CANDIDATE_DELIVERY',subjectId:{in:candidateMessageIds}},data:{status:'CANCELLED',leaseOwner:null,leaseUntil:null,error:'ACCOUNT_ERASED'}});
      await tx.chatMessage.updateMany({where:{id:{in:candidateMessages.map(m=>m.messageId).filter((id):id is string=>Boolean(id))}},data:{body:'Message removed'}});
      await tx.candidateMessage.updateMany({where:{id:{in:candidateMessageIds}},data:{recipientEmail:'erased@example.invalid',recipientUserId:null,subject:'Pesan dihapus',body:'Message removed',emailStatus:'CANCELLED',messageStatus:'CANCELLED',error:null}});
      await tx.candidateMessageBatch.updateMany({where:{messages:{some:{id:{in:candidateMessageIds}},every:{id:{in:candidateMessageIds}}}},data:{subject:'Pesan dihapus',bodyTemplate:'Message removed'}});
      await tx.candidateInterview.deleteMany({where:{candidateId:{in:candidateIds}}});
      await tx.candidateActivity.deleteMany({where:{candidateId:{in:candidateIds}}});
      await tx.recruitmentCandidate.updateMany({where:{id:{in:candidateIds}},data:{fullName:ANONYMIZED_DISPLAY_NAME,email:null,phone:null,headline:'',filename:'CV dihapus',fileKey:null,checksum:null,cvScore:null,cvResult:Prisma.DbNull,jobSnapshot:Prisma.DbNull,dedupeKey:null,scoreStatus:'ERASED',stage:'WITHDRAWN',error:null,revision:{increment:1}}});
      taraKeys=[...new Set([...taraKeys,...cvKeys])];
      const voiceRows=profile?await tx.voiceInterview.findMany({where:{session:{profileId:profile.id}},select:{id:true}}):[];
      const voiceIds=voiceRows.map(v=>v.id);
      if(voiceIds.length)await tx.$queryRaw(Prisma.sql`SELECT id FROM "VoiceInterview" WHERE id IN (${Prisma.join(voiceIds)}) ORDER BY id FOR UPDATE`);
      await tx.voiceFragment.deleteMany({where:{voiceId:{in:voiceIds}}});
      await tx.voiceInterview.updateMany({where:{id:{in:voiceIds}},data:{promptSnapshot:{erased:true},taraInterview:Prisma.DbNull,transcriptComplete:false}});
      await tx.voiceInterview.updateMany({where:{id:{in:voiceIds},status:{notIn:['ENDED','FAILED','CREATE_UNCERTAIN']}},data:{status:'CLOSING',closeReason:'ACCOUNT_ERASED',closingAt:new Date(),leaseUntil:new Date(0)}});
      // Provider IDs survive session deletion only until the watchdog confirms hangup; no CV or transcript remains.
      if (!profile) return;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "EmployeeProfile" WHERE id=${profile.id} FOR UPDATE`);
      const latestTara=await tx.aiScreeningSession.findMany({where:{profileId:profile.id},select:{id:true,coverFileKey:true,resumeVersionId:true,plans:{select:{id:true,resumeVersionId:true}},evaluation:{select:{pdfKey:true,revisions:{select:{snapshot:true}}}}}});
      const latestSubjects=[...taraSubjects,...latestTara.flatMap(s=>[s.id,s.resumeVersionId,...s.plans.flatMap(p=>[p.id,p.resumeVersionId])]).filter((id):id is string=>Boolean(id))];
      taraKeys=[...new Set([...taraKeys,...latestTara.flatMap(s=>[s.coverFileKey,s.evaluation?.pdfKey,...(s.evaluation?.revisions??[]).map(r=>(r.snapshot as {pdfKey?:string}).pdfKey)]).filter((key):key is string=>Boolean(key))])];
      await tx.aiScreeningWork.updateMany({where:{subjectId:{in:latestSubjects}},data:{status:'CANCELLED',leaseOwner:null,leaseUntil:null,error:'ACCOUNT_ERASED'}});
      await tx.aiScreeningCall.updateMany({where:{subjectId:{in:latestSubjects}},data:{status:'ERASED',result:Prisma.DbNull,error:null}});
      await tx.aiScreeningSession.deleteMany({where:{profileId:profile.id}});

      const applications = await tx.application.findMany({
        where: { profileId: profile.id },
        select: { id: true, status: true },
      });
      for (const application of applications) {
        const withdraw = (OPEN_APPLICATION_STATUSES as readonly string[]).includes(
          application.status,
        );
        await tx.application.update({
          where: { id: application.id },
          data: {
            ...(withdraw ? { status: 'WITHDRAWN' as const } : {}),
            coverLetter: null,
            resumeSnapshot: { anonymized: true },
            hrSubmissionSnapshot: Prisma.DbNull,
            recruiterEvaluations: { deleteMany: {} },
            resumeVersionId:null,
            matchScore: null,
            matchBreakdown: Prisma.DbNull,
            answers: { deleteMany: {} },
            interviews: { deleteMany: {} },
            events: {
              updateMany: { where: {}, data: { note: null } },
              ...(withdraw
                ? {
                    create: {
                      fromStatus: application.status,
                      toStatus: 'WITHDRAWN',
                      note: 'Candidate account deleted',
                    },
                  }
                : {}),
            },
          },
        });
        if (withdraw) {
          await tx.applicationOfferPacket.updateMany({
            where: { applicationId: application.id, kind: 'OFFER', status: 'PENDING' },
            data: { status: 'REVOKED', revokedAt: new Date() },
          });
        }
      }
      if (offerDocuments.length) {
        await tx.applicationOfferDocument.deleteMany({ where: { id: { in: offerDocuments.map(document => document.id) } } });
      }

      await tx.employeeProfile.update({
        where: { id: profile.id },
        data: {
          headline: null,
          summary: null,
          phone: null,
          // The anonymized account cannot authenticate. Reset its tombstone
          // state so clearing the phone satisfies the onboarding constraint.
          onboardingStatus:'IN_PROGRESS',
          onboardingStep:1,
          onboardingCompletedAt:null,
          desiredPosition: null,
          desiredPositions: [],
          preferredCountries: { set: [] },
          residenceCountryId: null,
          onboardingDraft: Prisma.DbNull,
          desiredSalaryMin: null,
          cityId: null,
          contentLocale: null,
          bulkCommsOptOut: false,
          bulkCommsOptOutAt: null,
        },
      });
      await tx.employeeProfileTranslation.deleteMany({ where: { profileId: profile.id } });
      await tx.profileSkill.deleteMany({ where: { profileId: profile.id } });
      await tx.profileLanguage.deleteMany({ where: { profileId: profile.id } });
      await tx.workExperience.deleteMany({ where: { profileId: profile.id } });
      await tx.education.deleteMany({ where: { profileId: profile.id } });
      await tx.certification.deleteMany({ where: { profileId: profile.id } });
      await tx.resume.updateMany({where:{id:{in:resumes.map(r=>r.id)}},data:{currentVersionId:null}});
      await tx.resumeVersion.deleteMany({where:{id:{in:cvVersions.map(v=>v.id)}}});
      for (const resume of resumes) {
        await tx.resume.update({
          where: { id: resume.id },
          data: {
            title: 'Removed',
            targetJobTitleId: null,
            fileKey: null,
            fileUrl: null,
            content: null,
            parsedData: Prisma.DbNull,
            parseError: null,
            parseStatus: 'NONE',
            builderMeta: Prisma.DbNull,
            isPrimary: false,
            deletedAt: new Date(),
          },
        });
      }
    }, {
      // This atomic cleanup touches screening, invitations and profile history.
      // Keep it bounded while allowing brief database contention beyond Prisma's 5s default.
      timeout: 30_000,
    });

    if (avatarKey) {
      await this.storage.delete(avatarKey).catch(() => undefined);
    }
    for (const resume of [...resumes,...cvVersions]) {
      const key = (resume.fileKey || '').trim();
      if (!key) continue;
      const stillOnResume = await this.prisma.resume.count({ where: { fileKey: key } });
      if (stillOnResume) continue;
      const snapshotRefs = await this.prisma.application.count({
        where: { resumeSnapshot: { path: ['resume', 'fileKey'], equals: key } },
      });
      if (snapshotRefs) continue;
      await this.storage.delete(key).catch(() => undefined);
    }
    for(const key of taraKeys)await this.storage.delete(key).catch(()=>undefined);
    for (const document of offerDocuments) {
      await this.storage.delete(document.storageKey);
    }

    return { ok: true as const, id: userId };
  }
}
