import assert from 'node:assert/strict';
import { assertFeaturedCompanySeedTarget } from './featured-company-seed-target';

const local = 'postgresql://local:secret@127.0.0.1:5432/job_talentio';
const vps = 'postgresql://talentio_app:secret@host.docker.internal:5432/talentio?schema=public';

assert.deepEqual(assertFeaturedCompanySeedTarget(local, 'local'), { target: 'local', database: 'job_talentio' });
assert.deepEqual(assertFeaturedCompanySeedTarget(vps, 'indonesia-vps'), { target: 'indonesia-vps', database: 'talentio' });
assert.throws(() => assertFeaturedCompanySeedTarget(local, 'indonesia-vps'), /indonesia-vps target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps, 'local'), /local target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps.replace('/talentio?', '/other?'), 'indonesia-vps'), /indonesia-vps target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps.replace('host.docker.internal', 'localhost'), 'indonesia-vps'), /indonesia-vps target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps.replace('talentio_app', 'postgres'), 'indonesia-vps'), /indonesia-vps target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps + '&sslmode=disable', 'indonesia-vps'), /indonesia-vps target/);
assert.throws(() => assertFeaturedCompanySeedTarget(vps, 'production'), /explicitly local or indonesia-vps/);

console.log('featured company seed target guards: smoke ok');
