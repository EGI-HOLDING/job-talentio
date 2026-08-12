# Multilanguage policy

Supported locales: `uz` (default), `ru`, `en` — see `apps/api/src/common/i18n/locale.ts`.

Every translatable field belongs to exactly one of five classes. Pick the class first; do not invent a sixth pattern.

## Field classes

| Class | Pattern | Storage | Examples |
|---|---|---|---|
| A. Product chrome | Dictionary keys | `apps/web/src/lib/i18n/dict/*`, `packages/shared/src/messages.ts` | Buttons, enum labels, emails, notification bodies |
| B. Shared catalog labels | `name` + `nameUz` / `nameRu` on the row | Prisma columns + `LocaleInterceptor` | Skill, JobTitle, Language, Benefit, City, Industry |
| C. Long public content | Parent `locale` + `*Translation` rows | `JobPostTranslation`, `NewsArticleTranslation`, `CompanyTranslation`, `JobQuestionTranslation` | Job posting, news article, company description, screening questions |
| D. Private UGC | None — keep the source language | — | Chat, cover letters, screening answers, notes, templates, reports |
| E. Public profile narrative | `contentLocale` marker + badge only | `EmployeeProfile.contentLocale` | Headline, summary, experience descriptions |

## Invariants

- Never force a user to enter three languages to create something.
- A human translation always wins; machine output never overwrites it.
- Proper names (`Company.name`, `User.fullName`, schools, issuers) are never translated.
- Class B falls back to the canonical English `name` when a locale column is empty, so a missing translation is a cosmetic gap, not an error.
- Machine translation is opt-in (`TRANSLATION_PROVIDER`) and bounded by a monthly character budget in Redis.

## Class B: open vs closed catalogs

Closed catalogs (Country, Province, City, JobCategory, Industry, IndustryGroup) are seeded and curated through
`apps/api/src/common/i18n/*-names.ts` plus `backfillCatalogI18n`. They have no runtime create path.

Open catalogs (Skill, JobTitle, Language, Benefit) are find-or-create from user input, so new rows arrive with
`name` only. Each carries an `i18nStatus`:

| Status | Meaning |
|---|---|
| `PENDING` | Natural-language label waiting for uz/ru |
| `COMPLETE` | Both locales present, or curated seed data |
| `IGNORED` | Tech or brand identity (React, TypeScript, C++) — identical in every language |

New rows are classified at create time by `isCatalogTechIdentity` (`apps/api/src/common/i18n/catalog-tech-identity.ts`).
Admins work the `PENDING` queue in the admin app: edit uz/ru by hand, run machine translation, mark a term as tech,
or merge a duplicate into an existing row. `nameUzIsMachine` / `nameRuIsMachine` record where a value came from.

## Class C: content translations

`resolveContent` (`apps/api/src/common/i18n/content-locale.ts`) picks requested locale, then human translation, then
machine translation, then the original. Readers see a `UgcText` badge when they get a fallback. `sourceHash` marks
machine output stale when the source text changes.

## Adding a new field

1. Chrome or enum: add a dictionary key. Never store it in the database.
2. Shared label reused across records: add `nameUz` / `nameRu` columns and let `LocaleInterceptor` rewrite `name`.
3. Long text written by one author for the public: add a translation table plus a `locale` column on the parent.
4. Anything written from one person to another: leave it alone.

## Operations

- `pnpm --filter @job-talentio/api backfill:catalog-i18n` — apply curated name maps.
- `pnpm --filter @job-talentio/api backfill:catalog-status` — classify existing catalog rows into `PENDING` / `COMPLETE` / `IGNORED`.
- `pnpm --filter @job-talentio/api backfill:content-locale` — re-detect the language of job postings and company profiles, so nothing claims to be Uzbek just because that is the column default.
- Machine translation requires `TRANSLATION_PROVIDER` plus `TRANSLATION_API_KEY`; Google is required when `uz` is a target because DeepL has no Uzbek.

`JobPost.locale` and `Company.locale` both default to `uz`. Any code path that writes those
fields without setting the language must either detect it or leave the row for the backfill,
otherwise readers get a "written in Uzbek" badge on English text.
