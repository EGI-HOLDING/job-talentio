import 'reflect-metadata';
import assert from 'node:assert/strict';
import { JobsController } from './jobs.controller';

async function main() {
  for (const [fields, hasSignal] of [
    [{ resumes: [{currentVersion:{parseStatus:'READY'}}] }, true],
    [{ resumes: [{currentVersion:{parseStatus:'PENDING'}}] }, false],
    [{ resumes: [{currentVersion:{parseStatus:'FAILED'}}] }, false],
    [{ desiredPositions: ['Data Analyst', 'Full-stack Developer'] }, false],
    [{ desiredPosition: 'Full-stack Developer' }, false],
    [{ headline: 'Software Engineer' }, false],
    [{ experiences: [{ title: 'Engineer' }] }, false],
    [{ _count: { skills: 1 } }, false],
    [{}, false],
  ] as const) {
    let received: any;
    const profile = Object.assign({ id: 'profile',resumes:[], desiredPositions: [], desiredPosition: null, headline: null, experiences: [], _count: { skills: 0 } }, fields);
    const controller = new JobsController({ search: async (query: unknown) => { received = query; return query; } } as never, {
      employeeProfile: { findUnique: async (args: any) => {
        assert.equal(args.select.resumes.where.isPrimary, true);
        assert.equal(args.select.resumes.select.currentVersion.select.parseStatus, true);
        return profile;
      } },
    } as never);
    await controller.search({ sort: 'match' }, { headers: {} } as never, { id: 'employee', role: 'EMPLOYEE' } as never);
    assert.equal(received.profileId, hasSignal ? 'profile' : undefined);
    assert.equal(received.sort, hasSignal ? 'match' : 'relevance');
  }
  console.log('PASS: job list matching uses the primary CV; pending/failed CVs and manual career fields cannot produce a match badge');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
