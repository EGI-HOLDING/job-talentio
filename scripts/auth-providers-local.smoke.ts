// Real local API/DB and actual Telegram handler. Bot messages are captured, never sent.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '../apps/api/node_modules/@prisma/client';
import { ConfigService } from '../apps/api/node_modules/@nestjs/config';
import { TelegramService } from '../apps/api/src/telegram/telegram.service';
const { config, assertDemoUrl } = require('./lib/hr-demo-env.cjs');

async function main() {
  const { env } = config({ realAuth: true }); assertDemoUrl(env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const telegram = new TelegramService(db as any, new ConfigService(env), {} as any, {} as any);
  const messages: unknown[] = []; telegram.sendMessage = async (...args) => { messages.push(args); return true; };
  const base = 'http://localhost:4000/api', phone = '+1999' + randomBytes(4).readUInt32BE().toString().padStart(10, '0').slice(-7), chatId = 8000000000 + randomBytes(4).readUInt32BE();
  let hash: string | undefined;
  try {
    const [google, widget, providers] = await Promise.all(['/auth/google/config', '/auth/telegram/config', '/auth/phone/providers'].map(route => fetch(base + route).then(response => response.json()))) as any[];
    assert.equal(google.available, true); assert.ok(google.clientId); assert.equal(widget.available, true); assert.equal(providers.telegram, true);
    const startResponse = await fetch(base + '/auth/phone/telegram/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: 'id' }) });
    assert.equal(startResponse.status, 201); const start = await startResponse.json() as any;
    hash = createHash('sha256').update(start.token).digest('hex'); assert.ok(start.deepLink.includes('phone_' + start.token));
    const status = () => fetch(base + '/auth/phone/telegram/status?token=' + encodeURIComponent(start.token)).then(response => response.json()) as Promise<any>;
    assert.equal((await status()).status, 'PENDING');
    const from = { id: chatId, first_name: 'Local Auth Audit', language_code: 'id' }, chat = { id: chatId };
    await telegram.handleUpdate({ message: { chat, from, text: '/start phone_' + start.token } }); assert.equal((await status()).status, 'CONTACT_REQUESTED');
    await telegram.handleUpdate({ message: { chat, from, contact: { user_id: chatId + 1, phone_number: phone } } }); assert.equal((await status()).status, 'CONTACT_REQUESTED', 'another person’s contact cannot complete sign-in');
    await telegram.handleUpdate({ message: { chat, from, contact: { user_id: chatId, phone_number: phone } } });
    const result = await status(); assert.equal(result.status, 'COMPLETED'); assert.ok(result.session.accessToken); assert.equal(result.session.user.role, 'EMPLOYEE'); assert.equal(result.session.user.employeeOnboarding.status, 'IN_PROGRESS');
    assert.equal((await status()).status, 'EXPIRED', 'a completed sign-in token is consumed once');
    const me = await fetch(base + '/auth/me', { headers: { Authorization: 'Bearer ' + result.session.accessToken } }); assert.equal(me.status, 200); assert.equal((await me.json() as any).user.id, result.session.user.id);
    const badGoogle = await fetch(base + '/auth/oauth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'not-a-google-token-with-invalid-signature' }) }); assert.equal(badGoogle.status, 401, 'invalid Google signature rejected');
    const badTelegram = await fetch(base + '/auth/oauth/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: String(chatId), first_name: from.first_name, auth_date: Math.floor(Date.now() / 1000), hash: '0'.repeat(64) }) }); assert.equal(badTelegram.status, 401, 'invalid Telegram signature rejected');
    assert.ok(messages.length >= 3);
    console.log('PASS local provider API: configured options, verified own contact, actual employee session/onboarding, one-time token and invalid Google/Telegram signatures rejected; no external messages');
  } finally {
    if (hash) await db.phoneLoginToken.deleteMany({ where: { tokenHash: hash } });
    await db.user.deleteMany({ where: { telegramId: String(chatId), phone } }); await db.$disconnect();
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Auth provider integration failed'); process.exitCode = 1; });
