const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
module.exports = function loadReview() {
  const repo = path.resolve(__dirname, '../..'), web = createRequire(path.join(repo, 'apps/web/package.json')), ts = web('typescript'), target = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(repo, 'apps/web/src/components/onboarding/CvReview.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: target, exports: target.exports, require(name) {
    if (['react', 'react/jsx-runtime', '@job-talentio/shared'].includes(name)) return web(name);
    if (name.endsWith('.css')) return {};
    if (name === './ExperienceEditor') return { ExperienceEditor: () => null };
    if (name === '@/lib/i18n') return { useEnumLabel: () => value => value };
    if (name === '@/lib/i18n/onboarding') return { useOnboardingText: () => value => value };
    throw Error('Unexpected CV review dependency: ' + name);
  } });
  return target.exports;
};
