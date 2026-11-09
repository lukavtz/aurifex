#!/usr/bin/env bash
# Creates a compressed PostgreSQL dump and prunes dumps older than RETENTION_DAYS.
# Prints only the new dump path on stdout; all diagnostics go to stderr.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/aurifex-${STAMP}.dump"

fail() {
  printf 'backup-postgres: %s\n' "$*" >&2
  exit 1
}

# An exported but empty variable is a configuration error, not "unset".
if [ -n "${DATABASE_URL+x}" ] && [ -z "$DATABASE_URL" ]; then
  fail "DATABASE_URL is set but empty"
fi
if [ -n "${POSTGRES_PASSWORD+x}" ] && [ -z "$POSTGRES_PASSWORD" ]; then
  fail "POSTGRES_PASSWORD is set but empty"
fi
if [ -z "${DATABASE_URL:-}" ] && [ -z "${POSTGRES_PASSWORD:-}" ]; then
  fail "DATABASE_URL or POSTGRES_PASSWORD is required"
fi

command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found in PATH"

# libpq reads PGPASSWORD; POSTGRES_PASSWORD is only a fallback for ambient config.
if [ -z "${PGPASSWORD:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  PGPASSWORD="$POSTGRES_PASSWORD"
  export PGPASSWORD
fi

mkdir -p "$BACKUP_DIR"
umask 077
trap 'rm -f "$OUT"' ERR

# PGDATABASE is treated as a plain database name, so a URL must go through --dbname.
if [ -n "${DATABASE_URL:-}" ]; then
  pg_dump -Fc -f "$OUT" --dbname="$DATABASE_URL"
else
  pg_dump -Fc -f "$OUT"
fi
chmod 600 "$OUT"
trap - ERR

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'aurifex-*.dump' -mtime "+${RETENTION_DAYS}" \
  -exec rm -f {} +

printf '%s\n' "$OUT"