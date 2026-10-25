#!/bin/sh
set -eu
# The app owns only its database; it never receives the cluster administrator credential.
app_password=$(cat /run/secrets/db_app_password)
case "$app_password" in
  ''|*[!a-zA-Z0-9_-]*) echo 'Use a URL-safe application database password' >&2; exit 1 ;;
esac
# The restricted alphabet makes the SQL literal safe. Send it over stdin,
# keeping the credential out of process arguments and Docker environment.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE margin LOGIN PASSWORD '$app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE margin OWNER TO margin;
SQL
