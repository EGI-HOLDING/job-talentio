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

function llmKeepsLongDescriptionAndNewlines() {
  const longDuty = `${'Duty line with enough text to pad. '.repeat(40)}end.`;
  assert(longDuty.length > 1000, 'fixture should exceed old 1000 cap');
  const parsed = normalizeLlmCvPayload(
    {
      headline: 'IT Specialist',
      skillNames: [],
      experiences: [
        {
          title: 'IT Infrastructure & Support Specialist',
          companyName: 'Acme',
          startDate: '2023-01-01',
          endDate: '2024-12-01',
          isCurrent: false,
          description: `• Manage infrastructure\n• Provide Level 1 and Level 2 support\n${longDuty}`,
        },
        {
          title: 'IT Support Engineer',
          companyName: 'Acme',
          startDate: '2022-01-01',
          endDate: null,
          isCurrent: true,
          description: ['Configure switches', 'Handle tickets'],
        },
      ],
      educations: [],
      languages: [],
    },
    { sourceText: 'Contact me at alice@example.com. '.repeat(10), knownSkills: [], ocrUsed: false },
  );

  const first = parsed.experiences[0]?.description || '';
  assert(first.length > 1000, `description truncated to ${first.length}`);
  assert(first.length <= 5000, `description over schema max: ${first.length}`);
  assert(first.includes('\n'), `newlines collapsed: ${JSON.stringify(first.slice(0, 80))}`);
  assert(/Level 1 and Level 2/i.test(first), 'Level 1/2 bullet dropped in normalize');
  assert(!/IT Support Engineer/i.test(first), 'next title leaked into first description');
  assert(
    parsed.experiences[1]?.description === 'Configure switches\nHandle tickets',
    `array description not joined: ${parsed.experiences[1]?.description}`,
  );
}

function truncateRejoinsWraps() {
  const wrapped =
    '• Provide Level 1 and Level 2 support for Windows workstations, printers, POS devices, IP phones, and operational\nsystems.\nIT Support Engineer';
  const out = truncateCvTextForLlm(wrapped);
  assert(/operational systems\./i.test(out), `truncate did not rejoin:\n${out}`);
  assert(/\nIT Support Engineer/.test(out), `truncate glued next title:\n${out}`);
}

async function main() {
  truncatesLongText();
  skillNormalizePrefersCatalog();
  llmPayloadNormalized();
  llmKeepsLongDescriptionAndNewlines();
  truncateRejoinsWraps();
  console.log('api: llm-cv-normalize smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
