import 'reflect-metadata';
import assert from 'node:assert/strict';
import { JobsController } from './jobs.controller';

async function main() {
  for (const [fields, hasSignal] of [
    [{ desiredPositions: ['Data Analyst', 'Full-stack Developer'] }, true],
    [{ desiredPosition: 'Full-stack Developer' }, true],
    [{ headline: 'Software Engineer' }, true],
    [{ experiences: [{ title: 'Engineer' }] }, true],
    [{ _count: { skills: 1 } }, true],
    [{}, false],
  ] as const) {
    let received: any;
    const profile = Object.assign({ id: 'profile', desiredPositions: [], desiredPosition: null, headline: null, experiences: [], _count: { skills: 0 } }, fields);
    const controller = new JobsController({ search: async (query: unknown) => { received = query; return query; } } as never, {
      employeeProfile: { findUnique: async (args: any) => {
        assert.equal(args.select.desiredPositions, true);
        assert.equal(args.select.experiences.select.title, true);
        return profile;
      } },
    } as never);
    await controller.search({ sort: 'match' }, { headers: {} } as never, { id: 'employee', role: 'EMPLOYEE' } as never);
    assert.equal(received.profileId, hasSignal ? 'profile' : undefined);
    assert.equal(received.sort, hasSignal ? 'match' : 'relevance');
  }
  console.log('PASS: job list matching uses roles/history or skills; genuinely empty profiles stay unscored');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
