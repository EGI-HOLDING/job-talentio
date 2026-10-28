const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const ts = createRequire(path.join(repo, 'apps/api/package.json'))('typescript');

function table(search = '') {
  const writes = [];
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(repo, 'apps/admin/src/lib/useTableQuery.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({
    module, exports: module.exports, URLSearchParams,
    require: (name) => {
      if (name === 'react') return {
        useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }),
      };
      if (name === 'next/navigation') return {
        usePathname: () => '/verifications', useSearchParams: () => new URLSearchParams(search),
        useRouter: () => ({ replace: (url) => writes.push(url) }),
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(output, context);
  const result = module.exports.useTableQuery({ page: '1', limit: '25', status: 'PENDING', sort: 'createdAt', dir: 'desc' });
  return { result, writes };
}

test('admin: clearing a nonempty default persists an explicit empty filter', () => {
  const { result, writes } = table();
  result.setFilter('status', '');
  const url = new URL(writes[0], 'http://localhost:3001');
  assert.equal(url.searchParams.has('status'), true);
  assert.equal(url.searchParams.get('status'), '');
});
test('admin: fast filter changes compose before router navigation finishes', () => {
  const { result, writes } = table();
  result.setFilter('status', 'APPROVED');
  result.setFilter('q', 'audit');
  const url = new URL(writes[1], 'http://localhost:3001');
  assert.equal(url.searchParams.get('status'), 'APPROVED');
  assert.equal(url.searchParams.get('q'), 'audit');
});
test('admin: a quick sort change preserves the pending filter', () => {
  const { result, writes } = table();
  result.setMany({ status: 'APPROVED', q: 'audit' });
  result.toggleSort('status');
  const url = new URL(writes[1], 'http://localhost:3001');
  assert.equal(url.searchParams.get('q'), 'audit');
  assert.equal(url.searchParams.get('sort'), 'status');
});
test('admin: explicit empty URL filter overrides its default', () => {
  const { result } = table('status=');
  assert.equal(result.query.status, '');
});
