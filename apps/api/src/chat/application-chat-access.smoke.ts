import assert from 'node:assert/strict';
import { applicationChatAllowed } from './application-chat-access';

for (const status of ['NEW', 'IN_REVIEW', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', null, undefined]) {
  assert.equal(applicationChatAllowed(status), true, `chat should remain available for ${String(status)}`);
}
assert.equal(applicationChatAllowed('WITHDRAWN'), false, 'withdrawing an application closes its job chat');
console.log('application chat access: smoke ok');
