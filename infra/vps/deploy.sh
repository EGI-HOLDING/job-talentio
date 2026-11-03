#!/bin/bash
# Deploy the current branch of the repo to the Job Talentio staging stack on this host.
# Usage: deploy.sh [git-branch]   (default: develop)
set -euo pipefail

BRANCH="${1:-develop}"
cd /opt/job-talentio

echo "== fetching $BRANCH"
git -C src fetch --depth 1 origin "$BRANCH"
git -C src checkout -q -B deploy FETCH_HEAD

echo "== building images"
docker compose build api web admin

echo "== rolling out"
docker compose up -d

echo "== waiting for the API"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4018/api/health > /dev/null; then
    break
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:4018/api/health
echo
curl -fsS -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1:3018/uz
curl -fsS -o /dev/null -w "admin:%{http_code}\n" http://127.0.0.1:3019/
