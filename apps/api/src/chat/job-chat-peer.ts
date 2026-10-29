import type { PrismaClient } from '@prisma/client';

/** Job entry points must continue with the recruiter who actually wrote to this candidate. */
export async function jobChatPeers(db: Pick<PrismaClient,'conversation'>, candidateId: string, jobs: Array<{id:string;companyId:string}>) {
  const peers = new Map<string,string>();
  if (!jobs.length) return peers;
  const companies = new Map(jobs.map(job => [job.id,job.companyId]));
  const threads = await db.conversation.findMany({
    where:{jobPostId:{in:[...companies.keys()]},OR:[{userAId:candidateId},{userBId:candidateId}],messages:{some:{}}},
    include:{userA:{select:{id:true,role:true,isBanned:true,memberships:{select:{companyId:true}}}},userB:{select:{id:true,role:true,isBanned:true,memberships:{select:{companyId:true}}}}},
    orderBy:[{updatedAt:'desc'},{id:'asc'}],
  });
  for (const thread of threads) {
    const peer = thread.userAId === candidateId ? thread.userB : thread.userA;
    if (!thread.jobPostId || peers.has(thread.jobPostId) || peer.role !== 'RECRUITER' || peer.isBanned || !peer.memberships.some(member => member.companyId === companies.get(thread.jobPostId!))) continue;
    peers.set(thread.jobPostId,peer.id);
  }
  return peers;
}
