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
        assert.equal(args.select.id, true);
        return profile;
      } },
    } as never);
    await controller.search({ sort: 'match' }, { headers: {} } as never, { id: 'employee', role: 'EMPLOYEE' } as never);
    assert.equal(received.profileId, 'profile');
    assert.equal(received.sort, 'match');
  }
  console.log('PASS: Best Match always reaches V3.2; CV readiness never falls back to relevance or another engine');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
