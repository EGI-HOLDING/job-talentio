import { TranslationService } from './translation.service';
import type { TranslateRequest, TranslationProvider } from './translation.provider';
import { resolveContent } from '../common/i18n/content-locale';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Row = {
  id: string;
  name: string;
  nameUz: string | null;
  nameRu: string | null;
  nameUzIsMachine: boolean;
  nameRuIsMachine: boolean;
  i18nStatus: string;
};

function fakePrisma(row: Row) {
  const state = { ...row };
  return {
    prisma: {
      skill: {
        findUnique: async () => ({ ...state }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state, data);
          return { ...state };
        },
      },
    },
    state,
  };
}

/** Echoes a marker so tests can tell translated text from the source. */
function fakeProvider(output: (text: string, target: string) => string | null): TranslationProvider {
  return {
    name: 'fake',
    enabled: true,
    async translate({ texts, targetLocale }: TranslateRequest) {
      const value = output(texts[0], targetLocale);
      return value ? [value] : [];
    },
  };
}

function service(prisma: unknown, provider: TranslationProvider) {
  // A zero budget skips the Redis counter, keeping the test offline.
  const config = { get: (key: string) => (key === 'TRANSLATION_MONTHLY_CHAR_BUDGET' ? '0' : undefined) };
  return new TranslationService(
    prisma as never,
    config as never,
    provider,
    null,
  );
}

const BASE: Row = {
  id: 'sk_1',
  name: 'Sales Manager',
  nameUz: null,
  nameRu: null,
  nameUzIsMachine: false,
  nameRuIsMachine: false,
  i18nStatus: 'PENDING',
};

async function fillsBothLocales() {
  const { prisma, state } = fakePrisma(BASE);
  const svc = service(prisma, fakeProvider((text, target) => `${target}:${text}`));

  const result = await svc.translateCatalogLabel('skill', 'sk_1');
  assert(result.status === 'ready', `expected ready, got ${result.status}`);
  assert(state.nameUz === 'uz:Sales Manager', `uz not filled: ${state.nameUz}`);
  assert(state.nameRu === 'ru:Sales Manager', `ru not filled: ${state.nameRu}`);
  assert(state.nameUzIsMachine && state.nameRuIsMachine, 'machine flags not set');
  assert(state.i18nStatus === 'COMPLETE', `expected COMPLETE, got ${state.i18nStatus}`);
}

async function keepsHumanTranslation() {
  const { prisma, state } = fakePrisma({
    ...BASE,
    nameUz: 'Sotuv menejeri',
    nameUzIsMachine: false,
  });
  const svc = service(prisma, fakeProvider((text, target) => `${target}:${text}`));

  const result = await svc.translateCatalogLabel('skill', 'sk_1');
  assert(result.status === 'ready', `expected ready, got ${result.status}`);
  assert(state.nameUz === 'Sotuv menejeri', `human uz was overwritten: ${state.nameUz}`);
  assert(state.nameUzIsMachine === false, 'human uz marked as machine');
  assert(state.nameRu === 'ru:Sales Manager', `ru not filled: ${state.nameRu}`);
}

async function reportsUnsupportedTarget() {
  const { prisma, state } = fakePrisma(BASE);
  // Mirrors DeepL, which has no Uzbek target and returns nothing.
  const svc = service(prisma, fakeProvider(() => null));

  const result = await svc.translateCatalogLabel('skill', 'sk_1');
  assert(result.status === 'unsupported', `expected unsupported, got ${result.status}`);
  assert(state.nameUz === null && state.nameRu === null, 'row changed despite no output');
}

async function skipsWhenNothingMissing() {
  const { prisma, state } = fakePrisma({
    ...BASE,
    nameUz: 'Sotuv menejeri',
    nameRu: 'Менеджер по продажам',
  });
  const svc = service(prisma, fakeProvider(() => 'should not be called'));

  const result = await svc.translateCatalogLabel('skill', 'sk_1');
  assert(result.status === 'exists', `expected exists, got ${result.status}`);
  assert(state.i18nStatus === 'COMPLETE', `expected COMPLETE, got ${state.i18nStatus}`);
}

function servesQuestionInReaderLanguage() {
  const resolved = resolveContent(
    { question: 'Nechchi yil tajribangiz bor?' },
    'uz',
    [{ locale: 'ru', question: 'Сколько лет опыта?', isMachine: false }],
    'ru',
  );
  assert(resolved.content.question === 'Сколько лет опыта?', 'question not translated');
  assert(resolved.isFallback === false, 'translated question reported as fallback');

  const missing = resolveContent(
    { question: 'Nechchi yil tajribangiz bor?' },
    'uz',
    [],
    'en',
  );
  assert(missing.content.question === 'Nechchi yil tajribangiz bor?', 'fallback text changed');
  assert(missing.isFallback, 'missing translation not reported as fallback');
}

function prefersHumanCompanyDescription() {
  const resolved = resolveContent(
    { description: 'We build software.' },
    'en',
    [
      { locale: 'ru', description: 'Машинный текст', isMachine: true },
      { locale: 'ru', description: 'Человеческий текст', isMachine: false },
    ],
    'ru',
  );
  assert(
    resolved.content.description === 'Человеческий текст',
    `machine output won: ${resolved.content.description}`,
  );
  assert(resolved.isMachineTranslated === false, 'human text flagged as machine');
}

async function main() {
  await fillsBothLocales();
  await keepsHumanTranslation();
  await reportsUnsupportedTarget();
  await skipsWhenNothingMissing();
  servesQuestionInReaderLanguage();
  prefersHumanCompanyDescription();
  console.log('api: catalog translation smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
