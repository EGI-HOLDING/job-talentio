#!/usr/bin/env bash
set -euo pipefail
# Run on the VPS with an uploaded, reviewed source archive already extracted.
# Routing is a separate explicit step; this never changes another app's vhost.
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
case "$root" in /var/www/talentio/releases/*) ;; *) echo 'Unexpected release directory' >&2; exit 1;; esac
export TALENTIO_ENV_FILE=/var/www/talentio/shared/.env
test -f "$TALENTIO_ENV_FILE"
export RELEASE_ID=$(basename "$root")
compose=(docker compose --env-file "$TALENTIO_ENV_FILE" -f "$root/infra/vps/compose.yml")
"${compose[@]}" config --quiet
# Sequential builds keep the shared VPS memory usage bounded.
for service in api web admin; do "${compose[@]}" build "$service"; done
"${compose[@]}" up -d redis storage meilisearch
"${compose[@]}" run --rm api sh -c 'pnpm exec prisma migrate deploy'
if [ "${1:-}" = '--initialize' ]; then
    test -n "${CATALOG_SHA256:-}"
    "${compose[@]}" run --rm -v /var/www/talentio/shared/catalog.snapshot.json:/run/catalog.snapshot.json:ro api \
      node dist/scripts/initialize-vps-catalogs.js /run/catalog.snapshot.json "$CATALOG_SHA256" --dry-run
    "${compose[@]}" run --rm -v /var/www/talentio/shared/catalog.snapshot.json:/run/catalog.snapshot.json:ro api \
      node dist/scripts/initialize-vps-catalogs.js /run/catalog.snapshot.json "$CATALOG_SHA256" --apply
fi
"${compose[@]}" up -d --wait --wait-timeout 180 api web admin
curl --fail --silent http://127.0.0.1:14000/api/health
curl --fail --silent --output /dev/null http://127.0.0.1:13000/id
curl --fail --silent --output /dev/null http://127.0.0.1:13001/
ln -sfn "$root" /var/www/talentio/current
printf '\nRelease ready: %s\n' "$RELEASE_ID"
