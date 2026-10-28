import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { TelegramLocalPollingService } from './telegram-local-polling.service';
import { createHash } from 'node:crypto';

async function main() {
  const previousFetch = global.fetch, previousEnv = process.env.NODE_ENV;
  const requests: string[] = [], handled: unknown[] = [], lookups: any[] = [];
  let webhook = '', pending = true;
  global.fetch = (async (url: string) => {
    const method = url.split('/').pop()!; requests.push(method);
    assert.ok(['getWebhookInfo', 'getUpdates'].includes(method), 'test may not send messages or change external configuration');
    return { ok: true, status: 200, json: async () => ({ ok: true, result: method === 'getWebhookInfo' ? { url: webhook } : [] }) } as Response;
  }) as typeof fetch;
  const config = new ConfigService({ TELEGRAM_DEV_POLLING: 'true', DATABASE_URL: 'postgresql://local@127.0.0.1/demo', TELEGRAM_BOT_TOKEN: 'synthetic' });
  const db = { phoneLoginToken: { findFirst: async (query: any) => { lookups.push(query); return pending ? { id: 'local-sign-in' } : null; } } };
  const telegram = { isConfigured: () => true, handleUpdate: async (value: unknown) => { handled.push(value); } };
  const service = () => new TelegramLocalPollingService(config, db as any, telegram as any);
  try {
    process.env.NODE_ENV = 'production'; const production = service(); await production.onModuleInit(); assert.equal(production.ready, false); assert.equal(requests.length, 0);
    process.env.NODE_ENV = 'development'; config.set('DATABASE_URL', 'postgresql://host@remote.example/database'); const remote = service(); await remote.onModuleInit(); assert.equal(requests.length, 0);
    config.set('DATABASE_URL', 'postgresql://local@127.0.0.1/demo'); webhook = 'https://already-connected.example/webhook'; const occupied = service(); await occupied.onModuleInit(); assert.equal(occupied.ready, false); assert.equal(requests.filter(method => method === 'getUpdates').length, 0);
    webhook = ''; const local = service(); await local.onModuleInit(); assert.equal(local.ready, true); local.onModuleDestroy(); assert.equal(local.ready, false);
    const raw = 'a'.repeat(48), start = { update_id: 1, message: { chat: { id: 7, type: 'private' }, from: { id: 7 }, text: '/start phone_' + raw } };
    await (local as any).handleLocalLogin(start); assert.equal(handled.length, 1); assert.equal(lookups[0].where.tokenHash, createHash('sha256').update(raw).digest('hex'));
    pending = false; await (local as any).handleLocalLogin(start); assert.equal(handled.length, 1, 'unrelated bot sign-ins ignored');
    pending = true; await (local as any).handleLocalLogin({ message: { ...start.message, text: '/jobs' } }); await (local as any).handleLocalLogin({ message: { ...start.message, chat: { id: -1, type: 'group' } } }); assert.equal(handled.length, 1);
    await (local as any).handleLocalLogin({ message: { ...start.message, text: undefined, contact: { user_id: 7 } } }); assert.equal(handled.length, 2); assert.equal(lookups.at(-1).where.chatId, '7');
    console.log('PASS local Telegram receiver: development/local DB only, existing webhook preserved, local pending sign-ins only, shutdown stops polling');
  } finally { global.fetch = previousFetch; if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
