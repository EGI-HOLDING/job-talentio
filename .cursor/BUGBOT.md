# Job Talentio — Bugbot review rules

Bugbot does **not** read `.cursor/rules/*.mdc`. This file is the source of truth for PR review.

Focus on **correctness, security, and regressions**. Skip style nits, rename-only comments, and “add a test” unless the change is auth, billing, or data-loss related.

## Product and pipeline

- Monorepo: `apps/api` (Nest + Prisma), `apps/web` and `apps/admin` (Next.js), `packages/shared`.
- Git: PRs target **`develop`**, never `main`. Staging deploys from `develop`; production from `main` (Railway).
- CI (`.github/workflows/ci.yml`) must stay green: `pnpm install`, shared build, `prisma generate`, `typecheck`, `check:ascii-ui`, `check:i18n-ui`, `test`, `build`.
- Do not commit `.env`, credentials, private keys, or real `OPENAI_API_KEY` / `RESEND_API_KEY` / `TELEGRAM_BOT_TOKEN`.
- Do not add AI attribution to commits or PR text (`Co-authored-by: Cursor`, `Made with Cursor`, similar trailers).

## Security (flag these)

- **Auth:** `DEV_AUTH_ENABLED` / `devLogin` must stay local-only (`isDevLoginAllowed`). Never mint `SUPER_ADMIN` from client-supplied role in a secure runtime. JWT secret must fail boot in staging/prod when missing, default, or shorter than 32 chars (`resolveJwtSecret` / `isSecureRuntime`).
- **Billing:** Hot-job boosts are purchased via billing, not `POST /jobs/:id/hot` (that route must keep throwing). Silent payment auto-confirm only when `PAYMENTS_MOCK=true`. Do not treat mock checkout as a real provider settlement in staging/prod.
- **IDOR / tenancy:** Company-scoped reads and writes need membership (`assertMember` or equivalent). Unpublished jobs must not leak to non-members (404, not 403 with extras). Strip private company/member fields from public job payloads.
- **Webhooks:** Telegram webhook secret is required in secure runtimes when the bot is configured. Billing mock webhook must verify `PAYMENTS_WEBHOOK_SECRET`.
- **Admin / erasure:** Super-admin and anonymize/ban/plan changes stay behind admin auth. Account erasure must keep ownership-transfer / close-company guards.
- **Secrets in code:** No hardcoded production secrets. `.env.example` may show local placeholders only.

## UI / i18n

- User-visible copy in `apps/web` and `apps/admin` must go through i18n. CI `check:i18n-ui` and `check:ascii-ui` exist to catch hardcoded English and mojibake — do not regress them.
- Do not put secrets in `NEXT_PUBLIC_*`.

## Data

- Prisma migrations are expand/contract only; never destructive on staging/prod data.
- Seed must not run in Railway staging/prod. Do not revive demo passwords (`Admin123!`) as production defaults.
- Prefer fixing duplicate/close logic over forging unique fingerprints.

## How to comment

- One issue per real bug. Cite file and behavior. Suggest the smallest safe fix.
- If unsure (auth, payments, PII), say so — do not invent a “harmless” interpretation.
