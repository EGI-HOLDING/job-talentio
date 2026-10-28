const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const ts = createRequire(path.join(repo, 'apps/api/package.json'))('typescript');
const output = ts.transpileModule(fs.readFileSync(path.join(repo, 'apps/admin/src/lib/useAdminTable.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  let cursor = 0;
  let query = { q: 'first' };
  const hooks = [], effects = [], pages = [], selections = [], notices = [];
  const module = { exports: {} };
  const deferred = (queue) => (...args) => new Promise((resolve, reject) => queue.push({ args, resolve, reject }));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) hooks[index] = { deps, value: fn() };
      return hooks[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      const old = hooks[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        effects.push(() => {
          old?.cleanup?.();
          hooks[index] = { deps, cleanup: fn() };
        });
      }
    },
  };
  vm.runInNewContext(output, {
    module, exports: module.exports, Error,
    require(name) {
      if (name === 'react') return react;
      if (name === './useTableQuery') return { useTableQuery: () => ({ query }) };
      if (name === './api') return { apiList: deferred(pages), api: deferred(selections), toQueryString: (params) => `?q=${params.q}` };
      if (name === '@/components/ui/Toaster') return { useToast: () => ({ notify: (...args) => notices.push(args) }) };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  function render(nextQuery) {
    if (nextQuery) query = nextQuery;
    cursor = 0;
    const result = module.exports.useAdminTable({ path: '/admin/users', defaults: {}, filterKeys: ['q'] });
    effects.splice(0).forEach((run) => run());
    return result;
  }
  return { render, pages, selections, notices };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const page = (id) => ({ items: [{ id }], total: 1, page: 1, limit: 25, totalPages: 1 });

test('admin: an old filtered response cannot replace the current rows or loading state', async () => {
  const h = harness();
  h.render();
  h.render({ q: 'second' });
  h.pages[0].resolve(page('old'));
  await flush();
  assert.equal(h.render().loading, true);
  h.pages[1].resolve(page('current'));
  await flush();
  assert.equal(h.render().rows[0].id, 'current');
  assert.equal(h.render().loading, false);
});

test('admin: a stale failure cannot clear the current rows', async () => {
  const h = harness();
  h.render();
  h.render({ q: 'second' });
  h.pages[1].resolve(page('current'));
  await flush();
  h.pages[0].reject(new Error('Old request failed'));
  await flush();
  assert.equal(h.render().rows[0].id, 'current');
  assert.equal(h.render().error, '');
});

test('admin: overlapping reloads keep only the latest response', async () => {
  const h = harness();
  const table = h.render();
  const reload = table.reload();
  h.pages[1].reject(new Error('Current failure'));
  await reload;
  h.pages[0].resolve(page('old'));
  await flush();
  assert.equal(h.render().error, 'Current failure');
  assert.equal(h.render().rows.length, 0);
});

test('admin: changing filters discards a pending select-all response', async () => {
  const h = harness();
  const pending = h.render().selectAllMatching();
  h.render({ q: 'second' });
  h.selections[0].resolve({ ids: ['old-user'], capped: false });
  await pending;
  assert.equal(h.render().selected.size, 0);
  assert.equal(h.render().allMatching.active, false);
});

test('admin: clearing selection cancels a pending select-all response', async () => {
  const h = harness();
  const table = h.render();
  const pending = table.selectAllMatching();
  table.clearSelection();
  h.selections[0].resolve({ ids: ['old-user'], capped: false });
  await pending;
  assert.equal(h.render().selected.size, 0);
});

test('admin: selection notice reflects actual selection and the server cap', () => {
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(repo, 'apps/admin/src/components/data/TableChrome.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx, Fragment: 'fragment' } : {},
  });
  const notice = module.exports.SelectAllNotice;
  const props = { pageCount: 25, selectedOnPage: 0, selectedCount: 0, total: 1000, allMatchingSelected: false, capped: false };
  assert.equal(notice(props), null);
  assert.equal(notice({ ...props, selectedOnPage: 1, selectedCount: 1 }), null);
  assert.notEqual(notice({ ...props, selectedOnPage: 25, selectedCount: 25 }), null);
  const capped = notice({ ...props, selectedOnPage: 25, selectedCount: 500, allMatchingSelected: true, capped: true });
  assert.ok(JSON.stringify(capped).includes('first 500 of 1000'));
});
