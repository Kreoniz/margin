#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .local/backups
chmod 700 .local .local/backups
stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
target=".local/backups/margin-$stamp.dump"
test ! -e "$target"
temporary=$(mktemp .local/backups/.margin-dump.XXXXXX)
trap 'rm -f "$temporary"' EXIT HUP INT TERM
docker compose --env-file .env.production -f deploy/compose.production.yaml exec -T db \
  pg_dump -U margin_admin -d margin --format=custom --no-owner --no-acl > "$temporary"
test -s "$temporary"
docker compose --env-file .env.production -f deploy/compose.production.yaml exec -T db \
  pg_restore --list < "$temporary" > /dev/null
mv "$temporary" "$target"
find .local/backups -maxdepth 1 -type f -name 'margin-*.dump' -mtime +13 -delete
echo "$target"
