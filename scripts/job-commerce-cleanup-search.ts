import assert from 'node:assert/strict';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { rebuildJobsIndex } from '../apps/api/src/search/jobs-index.sync';
import { liveJobWhere } from '../apps/api/src/benefits/benefit-policy';
const {config, assertDemoUrl} = require('./lib/hr-demo-env.cjs');
async function main() {
  const c = config({realAuth: true}); assertDemoUrl(c.databaseUrl);
  assert.equal(c.env.MEILI_JOBS_INDEX, 'talentio_hr_demo_jobs');
  const db = new PrismaClient({datasources: {db: {url: c.databaseUrl}}});
  try {
    const count = await rebuildJobsIndex({prisma: db, host: c.env.MEILI_HOST, apiKey: c.env.MEILI_MASTER_KEY, index: c.env.MEILI_JOBS_INDEX});
    assert.equal(count, await db.jobPost.count({where: liveJobWhere()}));
    console.log('Local demo search projection restored:', count, 'published jobs');
  } finally {await db.$disconnect();}
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
