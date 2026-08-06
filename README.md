# Job Talentio

Enterprise job portal MVP for **Uzbekistan** (local-first). Marketplace + light ATS with three surfaces:

| App | URL | Purpose |
|-----|-----|---------|
| Web portal | http://localhost:3000 | Employees + Recruiters |
| Super Admin | http://localhost:3001 | Platform moderation |
| API | http://localhost:4000/api | NestJS backend |

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop

## Quick start

> Local ports avoid collisions with other Docker stacks: Postgres **5434**, Redis **6381**.

```bash
# 1) Infra containers
pnpm docker:up

# 2) Env
cp .env.example .env

# 3) Install & build shared
pnpm install
pnpm --filter @job-talentio/shared build

# 4) Database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5) Run apps
pnpm dev
```

### Demo accounts (after seed)

| Role | Email | Password |
|------|-------|----------|
| Super Admin | sarvar.adminov@jobtalentio.uz | Admin123! |
| Recruiter (Apex Soft) | jasur.tursunov@apexsoft.uz | Password123! |
| Employee | madina.karimova@gmail.com | Password123! |

Other seeded users use realistic name-based emails (Gmail / Mail.ru / Yandex / Inbox.uz for employees; `@company.uz` for recruiters). Password for all non-admin demo users: `Password123!`.

Seed volume (approx.): **20 companies**, **60 employees**, **90 job posts**, **~140 applications**.

Local extras:

- Mailpit UI: http://localhost:8025
- MinIO console: http://localhost:9001 (`minioadmin` / `minioadmin`)

## Monorepo layout

```
apps/api      NestJS + Prisma
apps/web      Next.js portal
apps/admin    Next.js Super Admin
packages/shared  Shared Zod schemas & constants
docker/       Postgres, Redis, MinIO, Mailpit
```

## Git workflow

We use **Git Flow** with two long-lived branches:

| Branch | Environment |
|--------|-------------|
| `develop` | Staging |
| `main` | Production |

**Rule of thumb:** every change goes on a short-lived branch (`feature/*`, `fix/*`, …) → Pull Request into **`develop`** → when staging is stable, PR **`develop` → `main`** for production.

Full details: [CONTRIBUTING.md](CONTRIBUTING.md)

CI runs on pushes/PRs to `main` and `develop` (see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Cloud deploy (Railway)

Staging and production run on **Railway** (Hobby-safe domain layout), with **Cloudflare** DNS/CDN + **R2** storage and **Hostinger SMTP** for email.

| Env | Branch | Domains |
|-----|--------|---------|
| Staging | `develop` | `staging.jobtalent.io`, `admin.staging…`, `api.staging…` |
| Production | `main` | `jobtalent.io`, `admin.jobtalent.io`, `api.jobtalent.io` |

`www` redirects to apex via Cloudflare (not a Railway custom domain — Hobby allows 2 domains per service).

Dockerfiles: `apps/api`, `apps/web`, `apps/admin`. Full checklist, env matrix, and Hobby cost tips: **[infra/README.md](infra/README.md)**.

Production DB migrate: `pnpm db:migrate:deploy` (also runs on API container start).

## Plans & billing (local)

- Free: 1 active published job
- Standard: 5
- Premium: 20 + cold chat
- Hot Job: time-boxed ranking boost
- Payments: `MockPaymentProvider` (auto-confirm) + Admin plan override

Payme/Click adapters can replace the mock provider later without changing the Railway layout.
