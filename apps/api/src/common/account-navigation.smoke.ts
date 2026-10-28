import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ChatService } from '../chat/chat.service';
import { ApplicationsService } from '../applications/applications.service';

async function main() {
  for (const role of ['EMPLOYEE', 'RECRUITER', 'SUPER_ADMIN']) {
    const notices: any[] = [];
    const telegram: string[] = [];
    const chat = new ChatService(
      { user: { findUnique: async () => ({ role, locale: 'id', telegramId: 'local-fixture' }) } } as never,
      {} as never,
      { create: async (notice: unknown) => { notices.push(notice); } } as never,
      { sendMessage: async (_id: string, text: string) => { telegram.push(text); } } as never,
    );
    await chat.notifyPeer({ peerId: 'recipient', senderId: 'sender', senderName: 'Test', body: 'Message', jobPostId: 'job-7', telegram: 'always' });
    assert.equal(notices.length, 1);
    const href = new URL(notices[0].linkUrl, 'http://local');
    assert.equal(href.searchParams.get('role'), role === 'EMPLOYEE' ? 'EMPLOYEE' : 'RECRUITER');
    assert.equal(href.searchParams.get('peer'), 'sender');
    assert.equal(href.searchParams.get('job'), 'job-7');
    assert.equal(telegram.length, 1);
    assert.ok(telegram[0].includes('/id' + notices[0].linkUrl));
  }

  const notices: any[] = [];
  const service = new ApplicationsService({
    employeeProfile: { findUnique: async () => ({ id: 'profile', resumes: [], skills: [], experiences: [], educations: [] }) },
    jobPost: { findUnique: async () => ({ id: 'job-7', companyId: 'company-2', title: 'Developer', status: 'PUBLISHED', questions: [], company: { name: 'Example', members: [{ userId: 'owner' }] } }) },
    application: { findUnique: async () => null, create: async () => ({ id: 'application-9', jobPost: { company: { name: 'Example' } } }) },
  } as never, {} as never, {} as never, { scoreProfileAgainstJob: async () => ({ total: 80 }) } as never,
  { create: async (notice: unknown) => { notices.push(notice); } } as never, {} as never);
  await service.apply({ id: 'candidate', role: 'EMPLOYEE', fullName: 'Test Candidate' } as never, 'job-7');
  assert.equal(notices.length, 1);
  const target = new URL(notices[0].linkUrl, 'http://local');
  assert.equal(target.pathname, '/dashboard/recruiter');
  for (const [key, value] of Object.entries({ tab: 'pipeline', company: 'company-2', job: 'job-7', application: 'application-9' })) {
    assert.equal(target.searchParams.get(key), value);
  }
  console.log('PASS: chat in-app/Telegram destinations preserve role and job; new applicants open the correct company pipeline. No network or database used.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
