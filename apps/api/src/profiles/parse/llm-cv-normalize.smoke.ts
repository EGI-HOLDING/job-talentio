import {
  isCvTextRichEnoughForLlm,
  normalizeLlmCvPayload,
  truncateCvTextForLlm,
} from './llm-cv-normalize';
import { normalizeSkillNames } from '../cv-parser';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function truncatesLongText() {
  const text = 'a'.repeat(20_000);
  const out = truncateCvTextForLlm(text, 12_000);
  assert(out.length <= 12_050, `truncated too long: ${out.length}`);
  assert(out.includes('[...truncated...]'), 'missing truncation marker');
}

function skillNormalizePrefersCatalog() {
  const names = normalizeSkillNames(
    ['react.js', 'UnknownSkill', 'TypeScript'],
    [
      { name: 'React', slug: 'react' },
      { name: 'TypeScript', slug: 'typescript' },
    ],
  );
  assert(names.includes('TypeScript'), 'catalog TypeScript missing');
  assert(names.includes('UnknownSkill'), 'free-text skill dropped');
  assert(names.includes('react.js') || names.includes('React'), 'react label missing');
}

function llmPayloadNormalized() {
  const text = 'Contact me at alice@example.com or +998901112233. '.repeat(10);
  assert(isCvTextRichEnoughForLlm(text), 'expected rich enough text');

  const parsed = normalizeLlmCvPayload(
    {
      email: null,
      phone: null,
      headline: 'Backend Developer',
      summary: 'Solid NestJS engineer',
      skillNames: ['NestJS', 'PostgreSQL'],
      experiences: [
        {
          title: 'Engineer',
          companyName: 'Acme',
          startDate: '2022-01',
          endDate: null,
          isCurrent: true,
          description: 'Built APIs',
        },
      ],
      educations: [{ school: 'NUUz', degree: 'BACHELOR', field: 'CS', startDate: '2018', endDate: '2022' }],
      languages: [{ name: 'English', code: 'en', level: 'B2' }],
    },
    {
      sourceText: text,
      knownSkills: [
        { name: 'NestJS', slug: 'nestjs' },
        { name: 'PostgreSQL', slug: 'postgresql' },
      ],
      ocrUsed: false,
    },
  );

  assert(parsed.email === 'alice@example.com', `email overlay failed: ${parsed.email}`);
  assert(parsed.headline === 'Backend Developer', 'headline missing');
  assert(parsed.experiences.length === 1, 'experience missing');
  assert(parsed.experiences[0].startDate === '2022-01-01', 'date normalize failed');
  assert(parsed.meta?.llmUsed === true, 'llmUsed flag missing');
  assert(parsed.meta?.provider === 'llm', 'provider meta wrong');
}

async function main() {
  truncatesLongText();
  skillNormalizePrefersCatalog();
  llmPayloadNormalized();
  console.log('api: llm-cv-normalize smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
