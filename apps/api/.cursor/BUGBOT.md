# API review (apps/api)

Included when the PR touches API files. Prefer bugs over style.

## Auth and sessions

- `POST /auth/dev-login` is local-only. `isSecureRuntime()` is true for `NODE_ENV=production`, Railway, or `REQUIRE_STRONG_SECRETS=true`.
- Role escalation via request body is a P0. Session revoke / refresh rotation must not leave reusable refresh tokens.
- Telegram login and link flows: validate bot token / login payload; webhook unsigned when secret missing in secure runtime is a P0 (`session-policy.ts`).

## Billing and jobs

- Plan upgrades and hot jobs: `billing.service.ts` `buyHotJob` / checkout. `jobs.controller.ts` `POST :id/hot` must remain a hard error pointing at billing.
- `confirmPayment(..., true)` auto-path is only for `PAYMENTS_MOCK=true`. A real provider must settle via webhook, not the client calling confirm.
- `activateHotJob` / `activateHotJobSystem` must not become a free public boost.

## Tenancy

- Job create/update/status, questions, translations, stats, recommended candidates: recruiter must belong to the job’s company (or super-admin).
- `GET /jobs/:id` for non-members: `PUBLISHED` only; use `stripPrivateCompanyFields`.
- Chat, applications, company invites: never return another company’s PII because the client sent a UUID.

## Admin

- `apps/api/src/admin/*` is super-admin only. Bulk ban / plan / hot / catalog merge are destructive — check ID lists and audit logging.
- User anonymize and company close must keep erasure guards (`erasure-guards.ts`).

## Prisma / workers

- `prisma generate` does not need a live DB; `migrate deploy` does. Do not add `migrate reset` or `deleteMany` on production paths.
- CV parse / translation workers: do not send raw PDF bytes to OpenAI; respect `TRANSLATION_MONTHLY_CHAR_BUDGET`.
