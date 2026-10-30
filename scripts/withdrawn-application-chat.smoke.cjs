const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const employee = read('apps/web/src/components/employee/ApplicationsWorkspace.tsx');
const recruiterDetail = read('apps/web/src/components/recruiter/ApplicationDetail.tsx');
const recruiterProfile = read('apps/web/src/components/recruiter/RecruiterCandidate.tsx');
const chatService = read('apps/api/src/chat/chat.service.ts');

assert.match(employee, /selected\.status !== 'WITHDRAWN' && selected\.jobPost\.company\?\.chatPeerUserId/);
assert.match(recruiterDetail, /data\.status!=='WITHDRAWN'&&<>/);
assert.match(recruiterDetail, /\/messages\?/);
assert.match(recruiterProfile, /matchJobId && data\.applicationForJob\?\.status === 'WITHDRAWN'/);
assert.ok((chatService.match(/applicationChatAllowed/g) || []).length >= 3, 'chat API must enforce withdrawn state when opening and accessing job chats');
console.log('withdrawn application chat: UI smoke ok');
