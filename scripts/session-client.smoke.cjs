const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const repo = path.resolve(__dirname, '..');
const ts = createRequire(path.join(repo, 'apps/api/package.json'))('typescript');
const client = process.argv[2];
if (!['web', 'admin'].includes(client)) throw new Error('Specify web or admin');
const prefix = client === 'web' ? 'jt_' : 'jt_admin_';

function loadClient(fetch) {
  const session = { accessToken: 'expired-access', refreshToken: 'valid-refresh', user: { role: 'RECRUITER' } };
  const values = new Map([
    [prefix + 'token', session.accessToken],
    [prefix + 'refresh', session.refreshToken],
    ...(client === 'web' ? [['jt_session', JSON.stringify(session)]] : []),
  ]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const source = fs.readFileSync(path.join(repo, `apps/${client}/src/lib/api.ts`), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, localStorage,
    window: { location: { pathname: '/en/settings' } },
    process: { env: { NEXT_PUBLIC_API_URL: 'http://localhost:4000' } },
    fetch, Headers, FormData, URLSearchParams,
    require: (name) => {
      if (name === '@/lib/locale') return { DEFAULT_LOCALE: 'en', localeFromPathname: () => 'en' };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(output, context, { filename: `${client}/api.ts` });
  return { api: module.exports.api, values };
}

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test(`${client}: expired access token refreshes /auth/me and retries with the new token`, async () => {
  const requests = [];
  const { api, values } = loadClient(async (url, options) => {
    requests.push({ url, authorization: options.headers?.get?.('Authorization') });
    if (url.endsWith('/auth/refresh')) return response(200, {
      accessToken: 'new-access', refreshToken: 'new-refresh', user: { role: 'RECRUITER' },
    });
    return options.headers.get('Authorization') === 'Bearer new-access'
      ? response(200, { user: { role: 'RECRUITER' } })
      : response(401, { message: 'Unauthorized' });
  });
  const result = await api('/auth/me');
  assert.equal(result.user.role, 'RECRUITER');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].authorization, 'Bearer new-access');
  assert.equal(values.get(prefix + 'refresh'), 'new-refresh');
});

for (const failure of ['network', 503, 429]) {
  test(`${client}: temporary refresh failure (${failure}) preserves the session`, async () => {
    const { api, values } = loadClient(async (url) => {
      if (url.endsWith('/auth/refresh')) {
        if (failure === 'network') throw new TypeError('Failed to fetch');
        return response(failure, { message: 'Temporarily unavailable' });
      }
      return response(401, { message: 'Unauthorized' });
    });
    await assert.rejects(api('/jobs/mine'));
    assert.equal(values.get(prefix + 'token'), 'expired-access');
    assert.equal(values.get(prefix + 'refresh'), 'valid-refresh');
  });
}

test(`${client}: rejected refresh clears the invalid session`, async () => {
  const { api, values } = loadClient(async () => response(401, { message: 'Unauthorized' }));
  await assert.rejects(api('/jobs/mine'));
  assert.equal(values.has(prefix + 'token'), false);
  assert.equal(values.has(prefix + 'refresh'), false);
});

test(`${client}: concurrent requests share one refresh`, async () => {
  let refreshes = 0;
  const { api } = loadClient(async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes += 1;
      return response(200, { accessToken: 'new-access', refreshToken: 'new-refresh', user: {} });
    }
    return options.headers.get('Authorization') === 'Bearer new-access'
      ? response(200, { ok: true }) : response(401, { message: 'Unauthorized' });
  });
  await Promise.all([api('/jobs/mine'), api('/companies/mine')]);
  assert.equal(refreshes, 1);
});

test(`${client}: public login does not send or refresh a stored session`, async () => {
  let calls = 0;
  let hadAuthorization = false;
  const { api, values } = loadClient(async (_url, options) => {
    calls += 1;
    hadAuthorization = options.headers.has('Authorization');
    return response(401, { message: 'Invalid email or password' });
  });
  await assert.rejects(api('/auth/login', { method: 'POST', auth: false, body: '{}' }));
  assert.equal(calls, 1);
  assert.equal(hadAuthorization, false);
  assert.equal(values.get(prefix + 'refresh'), 'valid-refresh');
});
