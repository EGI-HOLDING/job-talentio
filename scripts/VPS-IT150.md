# Explicit Indonesia VPS job seed

This batch is never loaded at API startup and is not part of the general demo seed.
It targets only database `talentio`, deployment `indonesia-vps`, database-managed
catalogs and the frozen catalog fingerprint embedded in the tool and manifest.
It creates three recruiter owners and three fictional companies, each with 50
published Indonesian IT jobs: 20 Free, 20 Standard and 10 Premium.

## Verification before applying

- Run `node scripts/vps-it150-manifest.smoke.cjs`.
- Restore a recent VPS backup into the disposable local test with
  `node scripts/vps-it150-local.smoke.cjs <private-backup.dump>`.
- Back up only the VPS `talentio` database. Never restore a PostgreSQL cluster.
- Copy the reviewed CJS and manifest over SSH, checking SHA-256 on both sides.
  The deployed API runtime supplies Prisma, bcrypt and the publication allocator;
  set `TALENTIO_API_ROOT=/app/apps/api` in the API container. No app rebuild,
  migration, Railway operation or develop/main merge is needed.

## Explicit CLI

`node <tool.cjs> dry-run <manifest.json>` prints the manifest SHA, full target
fingerprint and planned counts. Save this JSON outside Git with restricted access.

`node <tool.cjs> apply <manifest.json> <plan.json>` requires the same manifest and
target state. Set `VPS_SEED_HR_PASSWORD` in the execution environment; never embed
the password in source, manifest, command logs or the saved plan.

`node <tool.cjs> verify <manifest.json>` checks the persisted batch against its
manifest, including catalog fingerprints, owners, jobs, questions and packages.
The first apply requires empty core business tables. A completed batch replays
with zero writes, even when an HR has edited its jobs; verify reports that drift
instead of overwriting it. Missing batch rows stop replay and require review.

Before applying, upload the three manifest SVGs through the existing StorageService
to `public/seed/indonesia-it150-v1/<company-key>.svg`. Refuse overwriting existing
objects on a new batch. Remove only newly uploaded batch objects if SQL rolls back.
The stored URLs use the existing public Talentio bucket on the API domain.

Package selection is an explicitly audited administrative seed allocation. No
payment, paid order, employee or superadmin is created. The real BenefitsService
publication allocator starts each 30-day period and allocates promotions and
unused boost allowance. No boost episode is activated.

## After commit

Rebuild only Talentio's jobs search index using the deployed jobs-index.sync
helper. Check all three password logins, company ownership isolation, 50 jobs per
HR, package capabilities and expiry, all 150 public jobs, sample details from each
job group/package, logos, and catalog equality after API restart. Preserve a
private batch report, before/after backups and hashes. Credentials are delivered
directly to the user; no outbound email is needed.

If post-commit checks fail, repair the batch or remove only its deterministic
`it150_*` identities and related batch records after checking for HR edits and new
applications. Period/grant/audit rows must also be scoped to this batch. Do not
restore a whole database over new users, edits or applications. If any such data
has appeared, retain it and resolve the failure without destructive rollback.
