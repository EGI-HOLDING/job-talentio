# Cloud deploy — Railway + Cloudflare + Hostinger

Job Talentio deploys as a dual-environment Railway project:

| Environment | Git branch | Purpose |
|-------------|------------|---------|
| `staging` | `develop` | QA / pre-production |
| `production` | `main` | Live site |

Local development still uses [docker/docker-compose.yml](../docker/docker-compose.yml) (Postgres, Redis, MinIO, Mailpit).

## Architecture

```
Browser → Cloudflare (DNS/CDN/proxy)
            ├─ jobtalent.io                 → Railway web (prod)
            ├─ admin.jobtalent.io           → Railway admin (prod)
            ├─ api.jobtalent.io             → Railway api (prod)
            ├─ staging.jobtalent.io         → Railway web (staging)
            ├─ admin-staging.jobtalent.io   → Railway admin (staging)
            └─ api-staging.jobtalent.io     → Railway api (staging)

API → Postgres + Redis + MinIO (staging) / R2 (prod) + Hostinger SMTP
```

### Live staging URLs

| Surface | URL |
|---------|-----|
| Web | https://staging.jobtalent.io |
| Admin | https://admin-staging.jobtalent.io |
| API health | https://api-staging.jobtalent.io/api/health |
| MinIO S3 | https://minio-staging-staging-ba96.up.railway.app |

Git auto-deploy: `api` / `web` / `admin` watch branch `develop` in Railway environment `staging`.

### Hobby plan limits (important)

- **Custom domains:** max **2 per service**. Do **not** attach both apex and `www` to the same web service.
- Use Cloudflare Redirect for `www.jobtalent.io` → `https://jobtalent.io`.
- **Usage credit:** $5/month included. Two always-on environments usually exceed this; set a spending cap and keep staging resource limits low.

| Service | Custom domain on Railway |
|---------|--------------------------|
| web (prod) | `jobtalent.io` |
| admin (prod) | `admin.jobtalent.io` |
| api (prod) | `api.jobtalent.io` |
| web (staging) | `staging.jobtalent.io` |
| admin (staging) | `admin-staging.jobtalent.io` |
| api (staging) | `api-staging.jobtalent.io` |

Use single-level hostnames for staging (`admin-staging`, `api-staging`). Nested names like `admin.staging.jobtalent.io` are outside Cloudflare Universal SSL coverage (`*.jobtalent.io` only).

## Repo deploy assets

| Path | Role |
|------|------|
| [apps/api/Dockerfile](../apps/api/Dockerfile) | NestJS + Prisma migrate deploy |
| [apps/web/Dockerfile](../apps/web/Dockerfile) | Next.js standalone (portal) |
| [apps/admin/Dockerfile](../apps/admin/Dockerfile) | Next.js standalone (super admin) |
| [apps/*/railway.toml](../apps/api/railway.toml) | Build/healthcheck hints per service |

Build context for every Dockerfile is the **monorepo root**.

API healthcheck: `GET /api/health`

---

## 1. Railway project setup

1. Create project `job-talentio` and connect GitHub `EGI-HOLDING/job-talentio`.
2. Create environment **staging** (duplicate or empty), keep **production**.
3. Per environment, add services:
   - **Postgres** (Railway plugin)
   - **Redis** (production required; staging optional — alerts soft-fail without it)
   - **api** — Dockerfile `apps/api/Dockerfile`, root `/`
   - **web** — Dockerfile `apps/web/Dockerfile`, root `/`
   - **admin** — Dockerfile `apps/admin/Dockerfile`, root `/`
4. Branch mapping:
   - staging → watch `develop`
   - production → watch `main`
5. For each app service, set Config-as-code path if needed:
   - `apps/api/railway.toml` / `apps/web/railway.toml` / `apps/admin/railway.toml`
6. Staging: lower memory/CPU limits (e.g. ~0.5 GB RAM). Set a workspace **usage/spending limit**.

### Finish the API stack first (Postgres + Redis + variables)

Do this **before** relying on web/admin. Postgres/Redis are **separate Railway services** — the API Dockerfile does **not** create them.

1. **Canvas** (staging environment) → **+ Create** → **Database** → **PostgreSQL**. Wait until **Online**.
2. **+ Create** → **Database** → **Redis** (recommended even on staging if you will test job alerts; otherwise skip).
3. Open service **api** → **Variables**:
   - **Add variable** → **Add reference** → pick Postgres → `DATABASE_URL` (prefer the **private**/internal URL if Railway shows both).
   - If Redis exists: **Add reference** → Redis → `REDIS_URL` or `REDIS_PRIVATE_URL` (map the name to `REDIS_URL` on the api service).
4. Still on **api** → **Variables**, add the shared app secrets from [env.api.staging.example](./env.api.staging.example) (copy values; do not commit real secrets).
5. Confirm **api** build settings:
   - Builder: **Dockerfile**
   - Dockerfile path: `apps/api/Dockerfile`
   - Root directory: empty (monorepo root)
   - Config-as-code: `apps/api/railway.toml`
   - Healthcheck path: `/api/health`
   - Custom start command: empty
   - Serverless: **off**
6. **Deploy** / redeploy **api**. In deploy logs you should see `prisma migrate deploy` succeed, then the Nest process start.
7. Open `https://<api-public-host>/api/health` (custom domain or `*.up.railway.app`) and expect `status: ok`.

If migrate fails with connection errors, the usual cause is a missing/wrong `DATABASE_URL` reference or Postgres still provisioning.

### Reference variables (api)

Link plugin outputs into the `api` service:

- `DATABASE_URL` ← Postgres
- `REDIS_URL` ← Redis (omit on staging if unused)

---

## 2. Environment variables

Set separately on **staging** and **production**. Values below are production examples.

### api

```bash
NODE_ENV=production
DEV_AUTH_ENABLED=false
JWT_SECRET=<long-random-secret>
JWT_EXPIRES_IN=7d
WEB_URL=https://jobtalent.io
ADMIN_URL=https://admin.jobtalent.io
API_URL=https://api.jobtalent.io
SUPERADMIN_EMAIL=<your-admin@jobtalent.io>
SUPERADMIN_PASSWORD=<strong-password>
PAYMENT_PROVIDER=mock

# Cloudflare R2
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=<r2-access-key>
S3_SECRET_KEY=<r2-secret-key>
S3_BUCKET=job-talentio-prod
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://cdn.jobtalent.io

# Hostinger Email
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=noreply@jobtalent.io
SMTP_PASS=<mailbox-password>
SMTP_FROM="Job Talentio <noreply@jobtalent.io>"
```

Staging domains (single-level hostnames for Cloudflare Universal SSL): `https://staging.jobtalent.io`, `https://admin-staging.jobtalent.io`, `https://api-staging.jobtalent.io`. Use a different `JWT_SECRET` from production.

**Staging storage:** MinIO service `minio-staging` (volume `/data`, S3 API `:9000`, console `:9001`). API uses private endpoint `http://minio-staging.railway.internal:9000` with `S3_FORCE_PATH_STYLE=true`. Public object base URL: Railway MinIO domain + bucket. Production should switch to Cloudflare R2 when enabled.

### web / admin (also required at **Docker build** time)

```bash
NEXT_PUBLIC_API_URL=https://api.jobtalent.io
NEXT_PUBLIC_ADMIN_URL=https://admin.jobtalent.io   # web only
NEXT_PUBLIC_APP_NAME=Job Talentio
```

After changing `NEXT_PUBLIC_*`, **redeploy** web/admin so values bake into the client bundle.

Railway sets `PORT` automatically; apps already listen on `PORT`.

---

## 3. Cloudflare DNS (domain at Hostinger)

1. Add `jobtalent.io` to Cloudflare; at Hostinger switch nameservers to Cloudflare.
2. **Keep Hostinger email DNS** (MX, SPF, DKIM, DMARC) when migrating NS.
3. In Railway, add custom domains per service (table above). Cloudflare DNS:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME/A | `@` | Railway web target | Proxied |
| CNAME | `admin` | Railway admin target | Proxied |
| CNAME | `api` | Railway api target | Proxied |
| CNAME | `staging` | Railway web (staging) | Proxied |
| CNAME | `admin.staging` | Railway admin (staging) | Proxied |
| CNAME | `api.staging` | Railway api (staging) | Proxied |

4. Cloudflare **Redirect Rule:** `www.jobtalent.io/*` → `https://jobtalent.io/$1` (301). Do not add `www` as a Railway custom domain on Hobby.
5. SSL/TLS mode: **Full (strict)** once Railway certificates are issued.
6. Enable **WebSockets** (Socket.IO chat).
7. Avoid caching HTML for app routes; cache R2/CDN static assets only.

Optional CDN hostnames for R2: `cdn.jobtalent.io`, `cdn-staging.jobtalent.io`.

---

## 4. Object storage

### Staging — MinIO (Railway)

1. Service image `minio/minio:latest`, volume mount `/data`.
2. Start command: `minio server /data --address :9000 --console-address :9001` (use **Deploy**, not Redeploy, after changing start command).
3. Public domain target port `9000` (S3 API) or `9001` (console).
4. API vars: `S3_ENDPOINT=http://minio-staging.railway.internal:9000`, root user/pass as access keys, bucket `job-talentio-staging` (API auto-creates on boot).

### Production — Cloudflare R2 (when enabled)

1. Create bucket `job-talentio-prod`.
2. Create API tokens with Object Read & Write.
3. Enable public access (custom domain or r2.dev URL) and set `S3_PUBLIC_URL`.
4. Wire credentials into the production `api` service.

---

## 5. Hostinger Email (SMTP)

1. Create mailbox e.g. `noreply@jobtalent.io` in hPanel.
2. SMTP settings:

| Setting | Value |
|---------|-------|
| Host | `smtp.hostinger.com` |
| Port | `465` |
| Encryption | SSL (`SMTP_SECURE=true`) |
| User | full email address |
| Pass | mailbox password |

3. Prefer port **587** + `SMTP_SECURE=false` only if 465 is blocked.

---

## 6. Go-live checklist

- [ ] Staging deploys from `develop`; production from `main`
- [ ] `pnpm db:migrate:deploy` runs on api container start (Dockerfile CMD)
- [ ] `GET https://api…/api/health` returns ok
- [ ] Login employee / recruiter / admin
- [ ] Upload (CV/logo) lands in the correct R2 bucket
- [ ] Test email arrives via Hostinger
- [ ] Chat WebSocket works through Cloudflare
- [ ] `DEV_AUTH_ENABLED=false` on both envs
- [ ] Spending cap set; staging limits reduced
- [ ] Super Admin password rotated from defaults

## Cost tips (Hobby)

- Prefer smaller limits on staging services.
- Skip Redis on staging if job-alert queues are not under test.
- Pause staging when unused; custom domains remain configured.
- Upgrade to Pro when production traffic or dual always-on cost becomes painful.
