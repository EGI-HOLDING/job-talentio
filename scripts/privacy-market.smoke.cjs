const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');
const ts = require(require.resolve('typescript', { paths: [webRoot] }));

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const legal = require(path.join(webRoot, 'src', 'lib', 'i18n', 'legal.ts'));
const locales = ['id', 'en', 'ru', 'uz'];

assert.equal(legal.resolvePrivacyMarket('id'), 'id');
assert.equal(legal.resolvePrivacyMarket(' ID '), 'id');
assert.equal(legal.resolvePrivacyMarket('uz'), 'uz');
assert.equal(legal.resolvePrivacyMarket('invalid'), 'uz');
const originalMarket = process.env.NEXT_PUBLIC_PRIVACY_MARKET;
try {
  delete process.env.NEXT_PUBLIC_PRIVACY_MARKET;
  assert.equal(legal.resolvePrivacyMarket(), 'uz');
  process.env.NEXT_PUBLIC_PRIVACY_MARKET = 'id';
  assert.equal(legal.resolvePrivacyMarket(), 'id');
} finally {
  if (originalMarket === undefined) delete process.env.NEXT_PUBLIC_PRIVACY_MARKET;
  else process.env.NEXT_PUBLIC_PRIVACY_MARKET = originalMarket;
}

for (const locale of locales) {
  const indonesia = legal.getLegalDocument('privacy', locale, 'id');
  const legacyUzbekistan = legal.getLegalDocument('privacy', locale, 'uz');
  assert.deepEqual(legacyUzbekistan, legal.LEGAL_DOCS.privacy[locale]);

  const content = [indonesia.title, indonesia.updated, indonesia.intro,
    ...indonesia.sections.flatMap((section) => [section.heading, ...(section.paragraphs || []), ...(section.items || [])])]
    .join('\n');
  const lower = content.toLowerCase();

  assert.equal(indonesia.sections.length, 10, `${locale}: expected all 10 policy sections`);
  assert.match(content, /PT EGI Resources/i, `${locale}: missing Indonesia data controller`);
  assert.match(lower, /info@cari-kerja\.co\.id/, `${locale}: missing Indonesia privacy contact`);
  assert.match(lower, /cari-kerja\.co\.id/, `${locale}: missing Indonesia service domain`);
  assert.match(content, /2022/, `${locale}: missing PDP law reference`);
  assert.match(content, /Google/i, `${locale}: missing Google sign-in disclosure`);
  assert.match(content, /Telegram/i, `${locale}: missing Telegram integration disclosure`);
  assert.match(content, /LinkedIn/i, `${locale}: missing recruiter LinkedIn disclosure`);
  assert.match(content, /translation|terjemah|перевод|tarjima/i,
    `${locale}: missing optional machine-translation disclosure`);
  const cvParsingDisclosure = {
    id: /CV tidak dikirim ke penyedia AI untuk parsing/i,
    en: /CV files are not sent to an AI provider for parsing/i,
    ru: /файлы резюме не отправляются поставщику ИИ для распознавания/i,
    uz: /CV fayllari tahlil uchun AI provayderiga yuborilmaydi/i,
  }[locale];
  assert.match(content, cvParsingDisclosure, `${locale}: missing local CV parsing disclosure`);
  assert.doesNotMatch(lower, /jobtalent\.io|uzbekistan|узбекистан|o‘zbekiston|o'zbekiston|uzbekiston/,
    `${locale}: Indonesia policy contains Uzbekistan market details`);
  assert.doesNotMatch(lower, /30\s*(hari|days|дн|kun)/,
    `${locale}: do not promise an unverified 30-day deletion period`);
  assert.match(lower, /backup|cadangan|резервн|zaxira/,
    `${locale}: missing disclosure about backup retention`);
}

for (const locale of locales) {
  assert.deepEqual(legal.getLegalDocument('terms', locale, 'id'), legal.LEGAL_DOCS.terms[locale]);
}
console.log('Privacy market smoke checks passed for Indonesia and Uzbekistan across all four locales.');
