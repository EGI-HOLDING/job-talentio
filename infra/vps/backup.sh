#!/bin/bash
# Nightly backup of the Job Talentio staging data on this host.
set -euo pipefail
cd /opt/job-talentio
set -a
. ./.env
set +a

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="backups/$STAMP"
mkdir -p "$DEST"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DEST/db.dump"
docker run --rm \
  -v job-talentio_minio_data:/data:ro \
  -v "/opt/job-talentio/$DEST:/out" \
  alpine:3.20 tar -C /data -czf /out/minio.tar.gz .

chmod 600 "$DEST"/*
find backups -maxdepth 1 -type d -name '20*' -mtime +7 -exec rm -rf {} +
echo "backup ok: $DEST"
