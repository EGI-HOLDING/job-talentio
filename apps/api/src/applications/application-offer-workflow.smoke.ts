import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

type Fixture = { status: string; packetStatus?: string; candidateId?: string; allowCompany?: boolean; hasDocuments?: boolean };

function harness(options: Fixture) {
  const state: any = {
    application: {
      id: 'application-1', jobPostId: 'job-1', status: options.status, kanbanEnteredAt: new Date('2026-10-01'),
      jobPost: { id: 'job-1', title: 'Data Scientist', companyId: 'company-1' },
      profile: { id: 'profile-1', userId: options.candidateId ?? 'candidate-1', user: { id: options.candidateId ?? 'candidate-1', fullName: 'Candidate', email: 'candidate@example.test', emailVerified: false, locale: 'id' } },
    },
    packet: options.packetStatus ? { id: 'packet-1', applicationId: 'application-1', version: 1, kind: 'OFFER', status: options.packetStatus, createdById: 'hr-1', createdAt: new Date('2026-10-01'), documents: options.hasDocuments === false ? [] : [{ id: 'document-1', packetId: 'packet-1', storageKey: 'application-offers/private-key', originalName: 'offer.pdf', contentType: 'application/pdf', sizeBytes: 42, uploadedById: 'hr-1', createdAt: new Date('2026-10-01') }] } : null,
    events: [] as any[], audits: [] as any[], notifications: [] as any[],
  };
  const clone = (value: any) => value == null ? value : structuredClone(value);
  const tx: any = {
    $queryRaw: async () => [],
    company: { findUnique: async () => ({ isBanned: false, anonymizedAt: null }) },
    companyMember: { findUnique: async () => ({ role: 'OWNER' }) },
    application: {
      findUniqueOrThrow: async () => ({ ...clone(state.application), events: clone(state.events) }),
      update: async ({ data }: any) => (state.application = { ...state.application, ...data }),
      updateMany: async ({ where, data }: any) => {
        if (state.application.status !== where.status) return { count: 0 };
        state.application = { ...state.application, ...data };
        return { count: 1 };
      },
    },
    applicationOfferPacket: {
      findFirst: async ({ where }: any) => state.packet && state.packet.applicationId === where.applicationId && state.packet.kind === where.kind && (!where.status || state.packet.status === where.status) ? clone(state.packet) : null,
      aggregate: async () => ({ _max: { version: state.packet?.version ?? null } }),
      create: async ({ data }: any) => {
        const packetId = `packet-${data.version}`;
        const sourceDocuments = data.documents?.create ?? [];
        const documents = (Array.isArray(sourceDocuments) ? sourceDocuments : [sourceDocuments]).map((document: any, index: number) => ({ id: `document-${index + 1}`, packetId, ...document, createdAt: new Date('2026-10-30') }));
        state.packet = { id: packetId, ...data, createdAt: new Date('2026-10-30'), documents };
        return clone(state.packet);
      },
      update: async ({ where, data }: any) => {
        assert.equal(state.packet?.id, where.id);
        state.packet = { ...state.packet, ...data };
        return clone(state.packet);
      },
    },
    pipelineEvent: { create: async ({ data }: any) => { const event = { id: `event-${state.events.length + 1}`, ...data }; state.events.push(event); return event; } },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
    interview: { updateMany: async () => ({ count: 0 }) },
  };
  const prisma: any = {
    application: { findUnique: async () => clone(state.application) },
    applicationOfferPacket: {
      findMany: async () => state.packet ? [clone(state.packet)] : [],
      findFirst: async ({ where }: any) => state.packet && state.packet.applicationId === where.applicationId && state.packet.kind === where.kind && (!where.status || state.packet.status === where.status) ? clone(state.packet) : null,
    },
    applicationOfferDocument: { findFirst: async ({ where }: any) => state.packet?.id === where.packetId && state.packet.documents.some((document: any) => document.id === where.id) ? clone(state.packet.documents[0]) : null },
    companyMember: { findMany: async () => [{ userId: 'hr-1' }] },
    $transaction: async (run: (client: any) => Promise<any>) => run(tx),
  };
  const companies: any = {
    assertMember: async (user: any) => {
      if (options.allowCompany === false || !['RECRUITER', 'SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException();
      return { company: { isBanned: false, anonymizedAt: null }, membershipRole: 'OWNER' };
    },
  };
  const storage: any = {
    upload: async (_buffer: Buffer, filename: string, _contentType: string) => ({ key: `application-offers/application-1/${filename}` }),
    assertObjectAvailable: async () => undefined,
    getPresignedGetUrl: async () => 'https://private-storage.example/signed?token=secret',
    delete: async () => undefined,
  };
  const notifications: any = { create: async (data: any) => { state.notifications.push(data); return data; } };
  const service = new ApplicationsService(prisma, storage, companies, {} as any, notifications, { send: async () => undefined } as any);
  return { service, state };
}

const recruiter = { id: 'hr-1', role: 'RECRUITER' } as any;

async function main() {
{
  const { service, state } = harness({ status: 'INTERVIEW' });
  const result = await service.createOffer(recruiter, 'application-1', []);
  assert.equal(state.application.status, 'OFFER');
  assert.equal(result.packet.status, 'SHARED', 'an offer without files does not require an in-app candidate decision');
  assert.equal(result.packet.requiresCandidateDecision, false);
  assert.equal(state.notifications[0].bodyKey, 'notify.applicationOffer.external.body');
  const candidate = { id: 'candidate-1', role: 'EMPLOYEE' } as any;
  await assert.rejects(service.decideOffer(candidate, 'application-1', 'ACCEPT'), ConflictException);
}

{
  const { service, state } = harness({ status: 'INTERVIEW' });
  const pdf = { buffer: Buffer.from('%PDF-1.4'), originalname: 'offer.pdf', mimetype: 'application/pdf', size: 8 };
  const result = await service.createOffer(recruiter, 'application-1', [pdf]);
  assert.equal(result.packet.status, 'PENDING', 'an offer with attachments asks the candidate to decide in-app');
  assert.equal(result.packet.requiresCandidateDecision, true);
  await assert.rejects(service.updateStatus(recruiter, 'application-1', 'HIRED' as any), ConflictException);
  assert.equal(state.application.status, 'OFFER');
}

{
  const { service, state } = harness({ status: 'OFFER', packetStatus: 'PENDING' });
  await assert.rejects(service.updateStatus(recruiter, 'application-1', 'OFFER' as any), BadRequestException);
  await assert.rejects(service.updateStatus(recruiter, 'application-1', 'HIRED' as any), ConflictException, 'HR cannot override a documented offer awaiting candidate response');
  assert.equal(state.application.status, 'OFFER');
  assert.equal(state.packet.status, 'PENDING');
  assert.equal(state.events.length, 0);
}

{
  const { service, state } = harness({ status: 'OFFER', packetStatus: 'SHARED', hasDocuments: false });
  const result = await service.updateStatus(recruiter, 'application-1', 'HIRED' as any);
  assert.equal(result.status, 'HIRED', 'HR can hire directly without a candidate decision');
  assert.equal(state.packet.status, 'SHARED', 'Documentless offers remain informational when HR advances the stage');
  assert.equal(state.events.at(-1).toStatus, 'HIRED');
  await assert.rejects(service.updateStatus(recruiter, 'application-1', 'REJECTED' as any), ConflictException, 'normal HR status updates cannot undo HIRED');
}

{
  const { service, state } = harness({ status: 'OFFER', packetStatus: 'PENDING', hasDocuments: false });
  const candidate = { id: 'candidate-1', role: 'EMPLOYEE' } as any;
  await assert.rejects(service.decideOffer(candidate, 'application-1', 'ACCEPT'), ConflictException, 'a documentless offer does not ask the candidate to decide in-app');
  const history = await service.listOfferPackets(candidate, 'application-1');
  assert.equal(history.packets[0].status, 'SHARED', 'legacy documentless packets are presented as external-flow offers');
  assert.equal(history.packets[0].requiresCandidateDecision, false);
  const result = await service.updateStatus(recruiter, 'application-1', 'HIRED' as any);
  assert.equal(result.status, 'HIRED');
  assert.equal(state.packet.status, 'SHARED', 'legacy empty pending packets normalize before HR advances the Kanban');
}

{
  const { service, state } = harness({ status: 'OFFER', packetStatus: 'PENDING' });
  const candidate = { id: 'candidate-1', role: 'EMPLOYEE' } as any;
  const accepted = await service.decideOffer(candidate, 'application-1', 'ACCEPT');
  assert.equal(accepted.application.status, 'HIRED');
  assert.equal(accepted.packet.status, 'ACCEPTED');
  assert.equal(accepted.changed, true);
  assert.equal(JSON.stringify(accepted).includes('private-key'), false, 'storage keys never leave the API');
  assert.equal(JSON.stringify(accepted).includes('createdById'), false, 'internal packet creators are not returned');
  const retry = await service.decideOffer(candidate, 'application-1', 'ACCEPT');
  assert.equal(retry.changed, false, 'a duplicate acceptance is idempotent');
  assert.equal(state.events.length, 1, 'an idempotent retry does not duplicate pipeline history');
}

{
  const { service, state } = harness({ status: 'OFFER', packetStatus: 'PENDING' });
  const candidate = { id: 'candidate-1', role: 'EMPLOYEE' } as any;
  const declined = await service.decideOffer(candidate, 'application-1', 'DECLINE');
  assert.equal(declined.application.status, 'WITHDRAWN');
  assert.equal(declined.packet.status, 'DECLINED');
  assert.equal(state.events[0].note, 'OFFER_DECLINED');
  await assert.rejects(service.decideOffer({ id: 'another-candidate', role: 'EMPLOYEE' } as any, 'application-1', 'ACCEPT'), ForbiddenException);
}

{
  const { service } = harness({ status: 'INTERVIEW', packetStatus: 'REVOKED', allowCompany: false });
  await assert.rejects(service.listOfferPackets(recruiter, 'application-1'), ForbiddenException, 'a non-member of the employer company cannot read offer history');
  const staleCandidate = { id: 'candidate-1', role: 'EMPLOYEE' } as any;
  await assert.rejects(service.decideOffer(staleCandidate, 'application-1', 'ACCEPT'), ConflictException, 'a revoked offer cannot be decided');
}

{
  const { service } = harness({ status: 'HIRED', packetStatus: 'ACCEPTED' });
  const result = await service.downloadOfferDocument(recruiter, 'application-1', 'packet-1', 'document-1');
  assert.equal(result.expiresIn, 900);
  assert.equal(result.url.includes('private-key'), false);
  assert.equal(JSON.stringify(result).includes('storageKey'), false);
}

console.log('application offer workflow: smoke ok');
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
