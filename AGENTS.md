# Agent notes — Job Talentio

## Cursor Cloud specific instructions

Cloud Agents use `.cursor/environment.json`. `install` matches CI: pnpm 9.15.9, shared package build, Prisma client generate. It does **not** start Postgres, Redis, MinIO, or the Next.js apps.

After install, prefer the same checks as `.github/workflows/ci.yml`:

```bash
pnpm typecheck
pnpm check:ascii-ui
pnpm check:i18n-ui
pnpm test
```

`pnpm test` is mostly API smoke tests (no live database). `pnpm build` needs `DATABASE_URL` and `NEXT_PUBLIC_API_URL` like CI; it does not need Postgres to be up for Prisma generate.

Do not run `pnpm db:seed` or `prisma migrate reset` against staging/production. Do not commit `.env` or dashboard secrets.

Full local stack (optional, needs Docker): `pnpm docker:up` then `pnpm dev`. Compose ports: Postgres `5434`, Redis `6381`, API `4000`, web `3000`, admin `3001`. Defaults live in `.env.example`.

Put Cloud Agent secrets in the [Cloud Agents dashboard](https://cursor.com/dashboard/cloud-agents) (JWT, database, OpenAI, etc.). Never paste them into the repo.

Bugbot reads `.cursor/BUGBOT.md` (and `apps/api/.cursor/BUGBOT.md` for API diffs), not `.cursor/rules/*.mdc`. Enable the GitHub app on `EGI-HOLDING/job-talentio` via [Bugbot automations](https://cursor.com/automations/from-cursor/bugbot). Locally, run `/review-bugbot` before pushing.

## Git

Branch from `develop`. PR into `develop`. Never commit to `main`/`develop` directly. No AI co-author or “Made with Cursor” trailers.
