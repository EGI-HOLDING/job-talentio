const assert = require('node:assert/strict');
const { host, nodes, text } = require('./lib/react-hook-host.cjs');
const root = 'apps/web/src/components/auth/';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(file, name, api, extra = {}) {
  const intervals = new Map(); let sequence = 0;
  const window = { location: { href: '/id/login' }, setTimeout: () => ++sequence, clearTimeout() {}, open: () => null, ...extra.window };
  const dependencies = {
    '@/lib/api': { api, saveSession: extra.saveSession || (() => {}), ADMIN_URL: '/admin' },
    '@/lib/authReturn': { authDestination: value => value, roleMismatchKey: (actual, expected) => actual === expected ? null : 'mismatch', authRoleErrorKey: () => null },
    '@/lib/navigation': { localeHref: value => '/id' + value },
    '@/lib/i18n': { useI18n: () => ({ t: value => value, locale: 'id' }) },
    '@/components/ui/Field': { FormAlert: 'alert', FormField: 'field' },
    '@/lib/authSdk': { loadAuthSdk: extra.loadAuthSdk || (async () => {}) },
  };
  const component = host(root + file, name, dependencies, { window, document: {}, AbortController, DOMException,
    setInterval(fn) { const id = ++sequence; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    attachRefs(tree) { for (const node of nodes(tree, node => !!node.props?.ref && typeof node.type === 'string')) node.props.ref.current = { parentElement: { clientWidth: 360 }, replaceChildren() {} }; },
  });
  return { component, window, intervals };
}
async function main() {
  for (const [file, name] of [['GoogleSignIn.tsx', 'GoogleSignIn'], ['TelegramSignIn.tsx', 'TelegramSignIn'], ['PhoneSignIn.tsx', 'PhoneSignIn']]) {
    const { component } = setup(file, name, async () => file === 'PhoneSignIn.tsx' ? { telegram: false, sms: false } : { available: false });
    const tree = await component.render({ showWhenUnavailable: true });
    assert.match(text(tree), /authProvider.unavailable/, name + ' explains disabled options'); component.unmount();
    let fail = true;
    const retry = setup(file, name, async () => { if (fail) throw Error('network'); return file === 'PhoneSignIn.tsx' ? { telegram: true, sms: false } : { available: false }; });
    let error = await retry.component.render({ showWhenUnavailable: true }); assert.match(text(error), /authProvider.loadFailed/);
    fail = false; nodes(error, node => node.type === 'button' && text(node).trim() === 'workspace.retry')[0].props.onClick();
    error = await retry.component.render(); assert.doesNotMatch(text(error), /authProvider.loadFailed/); retry.component.unmount();
  }
  let initialized, rendered, saved;
  const google = setup('GoogleSignIn.tsx', 'GoogleSignIn', async (route, options) => route === '/auth/google/config' ? { available: true, clientId: 'configured-at-runtime' } : (assert.equal(JSON.parse(options.body).expectedRole, 'EMPLOYEE'), { accessToken: 'fixture', user: { role: 'EMPLOYEE' } }), {
    window: { google: { accounts: { id: { initialize: config => { initialized = config; }, renderButton: (el, options) => { rendered = options; } } } } }, saveSession: session => { saved = session; },
  });
  const googleTree = await google.component.render({ accountRole: 'EMPLOYEE', showWhenUnavailable: true });
  assert.equal(initialized.client_id, 'configured-at-runtime'); assert.equal(rendered.width, 360); assert.equal(rendered.locale, 'id');
  assert.equal(nodes(googleTree, node => node.type === 'button' && /googleContinue/.test(text(node))).length, 0, 'ready Google uses its native rendered button');
  initialized.callback({ credential: 'signed-fixture' }); await tick(); await google.component.render(); assert.equal(saved.accessToken, 'fixture'); assert.equal(google.window.location.href, '/id/jobs?mode=for-you'); google.component.unmount();
  let popupOpen = false, apiStarted = false, statusResolve, savedCount = 0, statusRequests = 0;
  const popup = { opener: 'caller', closed: false, location: { replace(url) { this.url = url; } }, close() { this.closed = true; } };
  const phone = setup('PhoneSignIn.tsx', 'PhoneSignIn', async route => {
    if (route === '/auth/phone/providers') return { telegram: true, sms: false };
    if (route === '/auth/phone/telegram/start') { apiStarted = true; assert.equal(popupOpen, true, 'popup opens in original click before async request'); return { token: 'fixture', deepLink: 'https://t.me/test?start=phone_fixture', botUsername: 'test', expiresAt: new Date(Date.now() + 60000).toISOString() }; }
    statusRequests++; return await new Promise(resolve => { statusResolve = resolve; });
  }, { window: { open() { popupOpen = true; return popup; } }, saveSession: () => { savedCount++; } });
  let tree = await phone.component.render({ showWhenUnavailable: true, accountRole: 'EMPLOYEE' });
  await nodes(tree, node => node.type === 'button' && text(node).trim() === 'phone.telegramCta')[0].props.onClick(); tree = await phone.component.render();
  assert.equal(apiStarted, true); assert.equal(popup.opener, null); assert.equal(popup.location.url, 'https://t.me/test?start=phone_fixture');
  const poll = [...phone.intervals.values()][0]; const first = poll(); await tick(); await poll(); assert.equal(statusRequests, 1, 'slow polls cannot overlap');
  nodes(tree, node => node.type === 'button' && text(node).trim() === 'cancel')[0].props.onClick();
  statusResolve({ status: 'COMPLETED', session: { accessToken: 'stale', user: { role: 'EMPLOYEE' } } }); await first; await phone.component.render(); assert.equal(savedCount, 0, 'cancelled phone login cannot save a delayed session'); phone.component.unmount();
  console.log('PASS auth provider UI: runtime config, native Google button, disabled/error/retry feedback, synchronous phone popup and cancelled/overlapping polls');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
