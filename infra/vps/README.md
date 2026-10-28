# Indonesia VPS deployment

This installation uses `/var/www/talentio` and the existing host PostgreSQL 16
cluster. Only the new `talentio` database and `talentio_app` role belong to it.
Never restore a whole cluster or change another application's database.

- Web: `https://cari-kerja.co.id`, loopback `13000`.
- API: `https://api.cari-kerja.co.id`, loopback `14000`.
- Admin: existing `https://su-stage.cari-kerja.co.id`, loopback `13001`.
- Storage: dedicated bucket `/talentio/` on the API domain, loopback `19000`.
- Redis, Meilisearch and object storage have dedicated volumes and a separate
  `172.30.64.0/24` Docker network. Do not use another app's volumes or credentials.

## Release preparation

1. Copy `.env.example` to `/var/www/talentio/shared/.env` with owner-only `0600`
   access. Generate independent JWT, database, search and storage secrets. Set
   the existing domain's authorized Google and SMTP settings separately.
2. Create the dedicated non-superuser role and database. Do not reuse the
   PostgreSQL superuser credentials in the application.
3. Build an archive from the reviewed commit; exclude `.env`, dependencies,
   `.git`, private artifacts and `output/`. Transfer over authenticated SSH/SFTP
   or SCP and check SHA-256 before extracting into `releases/<commit>`.
4. Copy the frozen local catalog snapshot to `shared/catalog.snapshot.json`
   with owner-only access. Use `initialize-vps-catalogs` for the initial empty
   database; never run the demo seed. It imports only the 15 catalog tables,
   verifies their fingerprints within the transaction, enables job packages and
   creates no users, companies or jobs. Only the known placeholders inserted by
   schema migrations may be replaced; existing real catalogs/business rows block it.
5. Run `CATALOG_SHA256=<snapshot fingerprint> bash infra/vps/release.sh --initialize`.
   Subsequent releases omit `--initialize` and must first back up `talentio` and
   check migration compatibility. The API startup command does not run migrations
   or seed catalogs; the release step runs migrations explicitly once.

The web image is built with Indonesia's API/admin/site URLs and default language
`id`. Railway keeps its existing `uz` default when these new settings are absent.
SMTP on port 587 uses STARTTLS (`SMTP_SECURE=false`), while port 465 uses implicit
TLS (`SMTP_SECURE=true`). Payment provider, LinkedIn, Instagram and candidate AI
remain subject to the previously agreed feature availability; never simulate a
payment on this production host.

## Domain takeover (separate final step)

Back up the existing vhost and inspect its exact server names. Verify all new
services on loopback and validate the proposed Nginx config before cutover.
Install `talentio.nginx.conf` only with explicit authorization for takeover.
It replaces every legacy proxy/alias on these hostnames; retired `fe-stage` and
`be-stage` return 410. Stop only the five confirmed legacy application containers
(`fe-prod`, `fe-stage`, `be-prod`, `be-stage`, `super-admin-stage`) and disable
their restart policies. Preserve their files and databases. Do not stop shared
Redis/PostgreSQL, prune other images/volumes, or restore old proxies on rollback.
If Talentio must be rolled back, use its prior image or maintenance instead.

Verify HTTPS, all four catalog locales, login/provider configuration, email
transport, private/public storage, WebSocket transport, search and the zero-user
initial state. Keep backups, fingerprints, container IDs and verification output
under the private shared directory. Back up the database and object volume to
separate storage before real business data is accepted.
