const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const repo = path.resolve(__dirname, '..');
const ts = createRequire(path.join(repo, 'apps/api/package.json'))('typescript');
const root = path.join(repo, 'apps/web/src');
const cache = new Map();
function readModule(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      if (!name.startsWith('.')) throw new Error(`Unexpected dictionary dependency: ${name}`);
      return readModule(path.resolve(path.dirname(file), `${name}.ts`));
    },
  });
  cache.set(file, module.exports);
  return module.exports;
}
const { DICT } = readModule(path.join(root, 'lib/i18n/dict/index.ts'));
const { ID_TRANSLATIONS } = readModule(path.join(root, 'lib/i18n/id.ts'));
// Onboarding uses its own typed hook. Read its literal dictionary without
// evaluating the React hook or treating those keys as global dictionary keys.
const onboardingTree=ts.createSourceFile('onboarding.ts',fs.readFileSync(path.join(root,'lib/i18n/onboarding.ts'),'utf8'),ts.ScriptTarget.Latest,true);
let onboardingCopy;
function findOnboardingCopy(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(onboardingTree)==='copy'){
    const literal=ts.isAsExpression(node.initializer)?node.initializer.expression:node.initializer;
    onboardingCopy=vm.runInNewContext('('+literal.getText(onboardingTree)+')');
  }
  ts.forEachChild(node,findOnboardingCopy);
}
findOnboardingCopy(onboardingTree);
const missing = [];
let count = 0;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    let onboardingHook=false;
    function findHook(node){
      if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='t'&&node.initializer&&ts.isCallExpression(node.initializer)&&ts.isIdentifier(node.initializer.expression)&&node.initializer.expression.text==='useOnboardingText')onboardingHook=true;
      ts.forEachChild(node,findHook);
    }
    findHook(tree);
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        count++;
        const key = node.arguments[0].text;
        if (!Object.hasOwn(onboardingHook ? onboardingCopy.en : DICT, key)) {
          const line = tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          missing.push(`${path.relative(repo, file)}:${line}: ${key}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
}
scan(root);
for(const key of new Set(Object.values(onboardingCopy).flatMap(labels=>Object.keys(labels)))){
  for(const locale of ['en','uz','ru','id'])if(!onboardingCopy[locale]?.[key]?.trim())missing.push(`Onboarding ${key}: missing ${locale}`);
}
for (const [key, labels] of Object.entries(DICT)) {
  for (const locale of ['en', 'uz', 'ru', 'id']) {
    const value = locale === 'id' ? ID_TRANSLATIONS[key] : labels[locale];
    if (typeof value !== 'string' || !value.trim()) missing.push(`Dictionary ${key}: missing ${locale}`);
  }
}
if (missing.length) { console.error(missing.join('\n')); process.exitCode = 1; }
else console.log(`i18n keys passed: ${count} literal references, ${Object.keys(DICT).length} keys in four languages.`);
