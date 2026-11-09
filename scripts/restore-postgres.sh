#!/usr/bin/env bash
# Restores a pg_dump custom-format dump into DATABASE_URL after an explicit --confirm.
# Verifies that the core tables exist and prints their row counts as JSON.
set -euo pipefail

DUMP=""
CONFIRMED=0

fail() {
  printf 'restore-postgres: %s\n' "$*" >&2
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRMED=1 ;;
    -h | --help)
      printf 'usage: restore-postgres.sh <dump> --confirm\n'
      exit 0
      ;;
    -*) fail "unknown option: ${arg}" ;;
    *)
      [ -z "$DUMP" ] || fail "unexpected extra argument: ${arg}"
      DUMP="$arg"
      ;;
  esac
done

[ "$CONFIRMED" -eq 1 ] || fail "--confirm is required"
[ -n "$DUMP" ] || fail "usage: restore-postgres.sh <dump> --confirm"
[ -f "$DUMP" ] || fail "dump not found: ${DUMP}"
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is required"

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found in PATH"
command -v psql >/dev/null 2>&1 || fail "psql not found in PATH"

# PGDATABASE is treated as a plain database name, so a URL must go through --dbname.
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$DUMP"

count_rows() {
  local table="$1" count
  count="$(psql --dbname="$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM ${table}")" ||
    fail "table missing or unreadable: ${table}"
  case "$count" in
    "" | *[!0-9]*) fail "unexpected row count for ${table}: ${count}" ;;
  esac
  printf '%s' "$count"
}

users="$(count_rows users)"
payments="$(count_rows payments)"
jobs="$(count_rows jobs)"

printf '{"users":%s,"payments":%s,"jobs":%s}\n' "$users" "$payments" "$jobs"