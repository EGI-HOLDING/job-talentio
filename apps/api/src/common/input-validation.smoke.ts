import assert from 'node:assert/strict';
import {
  adminBanSchema, adminUserListSchema, certificationSchema, chatMessageSchema,
  educationSchema, experienceSchema, interviewSchema, jobSearchSchema, applicationListSchema, notificationListSchema,
  jobAlertSchema, skillNameSchema, uniqueSkillNames,
} from '@job-talentio/shared';

assert.ok(!interviewSchema.safeParse({ scheduledAt: 'not-a-date' }).success);
assert.ok(!interviewSchema.safeParse({ scheduledAt: '2026-02-31T12:00:00Z' }).success);
assert.ok(interviewSchema.safeParse({ scheduledAt: '2026-11-01T12:00:00+05:00' }).success);
assert.ok(!interviewSchema.safeParse({ scheduledAt: '2026-11-01T12:00:00Z', meetingUrl: 'javascript:alert(1)' }).success);
assert.ok(!experienceSchema.safeParse({ companyName: 'Test', title: 'Engineer', startDate: 'invalid' }).success);
assert.ok(experienceSchema.safeParse({ companyName: 'Test', title: 'Engineer', startDate: '2025-01-01', endDate: null }).success);
assert.ok(!educationSchema.safeParse({ school: 'Test', startDate: '2026-02-31' }).success);
assert.ok(!certificationSchema.safeParse({ name: 'Test', expiresAt: 'tomorrow' }).success);
assert.ok(!adminUserListSchema.safeParse({ createdFrom: 'invalid' }).success);
assert.ok(adminUserListSchema.safeParse({ createdTo: '2026-10-21' }).success);
assert.ok(!adminBanSchema.safeParse({ banned: 'false' }).success);
assert.equal(adminBanSchema.parse({ banned: false }).banned, false);
assert.ok(!chatMessageSchema.safeParse({ body: '   \n ' }).success);
assert.equal(chatMessageSchema.parse({ body: '  Hello  ' }).body, 'Hello');
assert.ok(!jobSearchSchema.safeParse({ workMode: 'invalid' }).success);
assert.ok(!jobSearchSchema.safeParse({ employmentType: 'invalid' }).success);
assert.ok(!jobSearchSchema.safeParse({ experienceLevel: 'SENIOR,invalid' }).success);
assert.ok(jobSearchSchema.safeParse({ experienceLevel: 'SENIOR,LEAD' }).success);
assert.equal(jobSearchSchema.parse({ sort: 'featured' }).sort, 'featured');
const skillNames = ['R', 'C++', 'C#', '.NET', 'React (Hooks)'];
for (const name of skillNames) assert.equal(skillNameSchema.parse(' ' + name + ' '), name);
assert.deepEqual(uniqueSkillNames(['C#', 'c#', 'C++']), ['C#', 'C++']);
assert.deepEqual(jobSearchSchema.parse({ skillName: skillNames, skills: 'python', skillMode: 'AND' }).skillName, skillNames);
assert.deepEqual(jobSearchSchema.parse({ skillName: 'R' }).skillName, ['R']);
assert.ok(!jobSearchSchema.safeParse({ skillName: ['R', '   '] }).success);
assert.deepEqual(jobAlertSchema.parse({ name: 'Skills', skillSlugs: ['python'], skillNames }).skillSlugs, ['python']);
assert.ok(!applicationListSchema.safeParse({ status: 'invalid' }).success);
assert.ok(!applicationListSchema.safeParse({ minMatch: 'invalid' }).success);
assert.ok(!notificationListSchema.safeParse({ page: 'invalid' }).success);
console.log('api: input validation smoke ok');
