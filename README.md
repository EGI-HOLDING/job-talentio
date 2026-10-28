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
docs/         Program map & guides
```

Full module/route map (API, web pages, staging URLs, common change areas): **[docs/PROGRAM-MAP.md](docs/PROGRAM-MAP.md)**.

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
| Staging | `develop` | `staging.jobtalent.io`, `admin-staging.jobtalent.io`, `api-staging.jobtalent.io` |
| Production | `main` | `jobtalent.io`, `admin.jobtalent.io`, `api.jobtalent.io` |

`www` redirects to apex via Cloudflare (not a Railway custom domain — Hobby allows 2 domains per service).

Dockerfiles: `apps/api`, `apps/web`, `apps/admin`. Full checklist, env matrix, and Hobby cost tips: **[infra/README.md](infra/README.md)**.

Production DB migrate: `pnpm db:migrate:deploy` (also runs on API container start).

## Core feature access

Candidate search and CV database access are free for employers. Job publication
requires an explicitly selected per-job package (Free, Standard or Premium).
Paid packages activate only after verified payment; the unconfigured gateway
does not prevent choosing Free. Contact privacy, company membership, moderation
and anti-abuse limits remain enforced.

### Staging job package activation

The HR onboarding flow is company details → job draft → package selection →
publication. `hr_packages` must be enabled for package selection; a disabled
rollout still allows authorized draft/package reads, with an unavailable message
instead of an opaque 404. Mutations keep their feature gate.

Inside the approved Railway staging API service, run
`node dist/scripts/enable-staging-job-packages.js --dry-run`, then `--apply`.
The command rejects other projects/environments, checks all three package policies,
initializes existing publication periods under the publication lock, enables
`hr_rollout` and `hr_packages` atomically, and records a system audit event.
Repeating it leaves existing publication end dates unchanged. It does not run on
startup, change catalog tables, configure payments, or enable other feature flags.
Standard/Premium orders remain pending while the gateway is unavailable; test
payment completion remains restricted to local deployments.

## Exact staging catalog synchronization

`apps/api/src/scripts/catalog-sync.ts` exports the current local `talentio_hr_demo`
catalogs, computes a read-only staging plan, and applies it atomically. It covers
all 15 catalog/alias tables, including IDs, translations, metadata and timestamps.
Application records remain; unmatched optional references and lookup associations
are detached. Ambiguous mappings and conflicting association payloads block apply.

- `export --file <snapshot>` requires local Postgres on port 5434.
- `dry-run --file <snapshot> --report <plan>` requires the approved Railway staging environment.
- `apply --file <snapshot> --expected-plan <hash> --backup-receipt <receipt> --report <result>` additionally requires a matching, restore-verified full backup and maintenance.
- `CATALOG_SYNC_MAINTENANCE=true` starts only the health endpoint; application routes return 503 and no application providers or workers start.
- `CATALOG_SOURCE_MODE=database` prevents automatic job-title cleanup and showcase seeding from changing imported catalogs on restart. Keep it set after synchronization.

Operational SSH transport, full backup/reindex verification, and isolated PostgreSQL
18 restore rehearsal live in `scripts/catalog-sync-{railway,ops,rehearse}.cjs`.
Use a private run directory below `.catalog-sync-private/`; it is excluded from Git
and Docker builds. Keep snapshots and full database backups private. CI exercises
maintenance/target guards; `test:catalog-sync:local <snapshot>` exercises the
transaction against a disposable copy of the local demo database.
