import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ANONYMOUS_REVEAL_STATUSES, revealsAnonymousEmployer } from '../common/anonymous-job';
export const candidateRevealActivities:Prisma.CandidateActivityWhereInput={OR:[{kind:'INTERVIEW_SCHEDULED'},{kind:'STAGE_CHANGED',OR:ANONYMOUS_REVEAL_STATUSES.map(stage=>({detail:{path:['stage'],equals:stage}}))}]};
/** Imported candidates may reply to an HR invitation/message without inventing an Application. */
export async function recruitmentChatAccess(db:PrismaService|Prisma.TransactionClient,conversation:{jobPostId:string|null;companyId:string|null;userAId:string;userBId:string;initiatedBy:string;isColdOutreach:boolean}){
 if(!conversation.jobPostId||!conversation.isColdOutreach||![conversation.userAId,conversation.userBId].includes(conversation.initiatedBy))return null;
 const employee=await db.user.findFirst({where:{id:{in:[conversation.userAId,conversation.userBId],not:conversation.initiatedBy},role:'EMPLOYEE',isBanned:false,anonymizedAt:null,emailVerified:true},select:{id:true,email:true}});if(!employee)return null;
 const invitationOwner:Prisma.ScreeningInvitationWhereInput={messageStatus:'SENT',status:{not:'CANCELLED'},OR:[{claimedUserId:employee.id},...(employee.email?[{recipientEmail:{equals:employee.email,mode:'insensitive' as const}}]:[])]};
 const candidate=await db.recruitmentCandidate.findFirst({where:{jobId:conversation.jobPostId,...(conversation.companyId?{companyId:conversation.companyId}:{}),applicationId:null,stage:{not:'WITHDRAWN'},scoreStatus:{not:'ERASED'},company:{isBanned:false,anonymizedAt:null},OR:[{invitations:{some:invitationOwner}},{messages:{some:{recipientUserId:employee.id,messageStatus:'SENT'}}}]},include:{activities:{where:candidateRevealActivities,take:1}}});if(!candidate)return null;
 const member=await db.companyMember.findFirst({where:{companyId:candidate.companyId,userId:conversation.initiatedBy,user:{role:'RECRUITER',isBanned:false,anonymizedAt:null}},select:{id:true}});if(!member)return null;
 return {allowed:true,anonymousRevealed:revealsAnonymousEmployer(candidate.stage)||candidate.activities.length>0};
}
