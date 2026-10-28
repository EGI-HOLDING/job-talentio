import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { JobsController } from '../jobs/jobs.controller';
import { AdminController } from '../admin/admin.controller';
import { JobsService } from '../jobs/jobs.service';
import { ChatService } from '../chat/chat.service';
import { ProfilesService } from '../profiles/profiles.service';

const root = resolve(__dirname, '../../../..');
function source(path: string) { return readFileSync(join(root, path), 'utf8'); }
function routes(controller: { prototype: object }) {
  return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    const method = (controller.prototype as Record<string, object>)[name];
    return Reflect.hasMetadata(METHOD_METADATA, method)
      ? [`${RequestMethod[Reflect.getMetadata(METHOD_METADATA, method)]} ${Reflect.getMetadata(PATH_METADATA, method)}`]
      : [];
  });
}

assert.ok(!routes(JobsController).some((route) => route.endsWith('/hot')));
assert.ok(!routes(AdminController).some((route) => /\/(plan|hot)$/.test(route)));
assert.ok(!existsSync(join(root, 'apps/api/src/billing/billing.module.ts')));
assert.equal('activateHotJobSystem' in JobsService.prototype, false);
assert.equal('canColdOutreach' in ChatService.prototype, false);

for (const directory of ['apps/api/src', 'apps/web/src', 'apps/admin/src']) {
  function visit(dir: string) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(path) && !/smoke\./.test(path)) {
        const text = source(path);
        assert.doesNotMatch(text, /\bPLAN_LIMITS\b|\bPLAN_PRICES_UZS\b|\beffectivePlan\s*\(/, path);
        assert.doesNotMatch(text, /\.(?:subscription|payment)\.(?:create|upsert|update|findUnique|findMany|aggregate)\s*\(/, path);
        assert.doesNotMatch(text, /\/billing\/(?:companies|payments|webhooks)\//, path);
      }
    }
  }
  visit(directory);
}
assert.doesNotMatch(source('apps/api/prisma/seed.ts'), /\.(subscription|payment)\.(create|upsert|update)\s*\(/);
assert.doesNotMatch(source('apps/api/prisma/seed.ts'), /key: 'hot_jobs'/);
assert.doesNotMatch(source('apps/api/src/common/job-language-backfill.ts'), /subscription|vipish|PREMIUM|VIP/);

const jobs = new JobsService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const now = Date.now;
try {
  Date.now = () => 1_800_000_000_000;
  const base = { publishedAt: new Date(Date.now() - 3600_000), description: 'Role responsibilities. '.repeat(10), skillCount: 3 };
  const score = jobs.computeRankScore(base);
  for (const plan of ['FREE', 'STANDARD', 'PREMIUM', 'VIP']) {
    assert.equal(jobs.computeRankScore({ ...base, ...{ plan, boostWeight: 100, boostUntil: new Date(Date.now() + 86400_000) } }), score);
  }
  const legacy = { category: null, boostWeight: 100, boostUntil: new Date(Date.now() + 86400_000), isHot: true };
  assert.deepEqual(jobs.withResolvedIcons(legacy), { ...legacy, boostWeight: 0, boostUntil: null, isHot: false, benefits: undefined });
  assert.equal(legacy.boostWeight, 100, 'serialization must not mutate historical data');
} finally { Date.now = now; }

// Contact privacy and the scraping quota remain present after removing paid access.
assert.match(ProfilesService.prototype.revealCandidateContact.toString(), /assertRevealQuota/);
assert.match(source('apps/api/src/profiles/profiles.service.ts'), /REVEAL_LIMIT_PER_HOUR = 30/);
assert.match(source('apps/api/src/profiles/profiles.service.ts'), /resumeId,\s*jobPost: \{ companyId: \{ in: companyIds \} \}/);
console.log('PASS monetization removal: retired controllers/providers, no commercial readers/writers, neutral ranking and legacy boosts, privacy and anti-scraping protections retained.');
