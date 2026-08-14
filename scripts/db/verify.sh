#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Applies the migrations and the seed to a throwaway Postgres 16 cluster, then
# runs supabase/tests/*.sql against it. Exits non-zero on the first failure.
#
#   npm run db:verify              build, test, tear down
#   npm run db:verify:keep         leave the cluster running, print the DSN
#
# The cluster is local scratch. It never touches a Supabase project.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
CLUSTER_DIR="${BACKSTACK_CLUSTER_DIR:-${TMPDIR:-/tmp}/backstack-verify.$$}"
DATA_DIR="$CLUSTER_DIR/data"
SOCK_DIR="$CLUSTER_DIR/sock"
LOG_FILE="$CLUSTER_DIR/postgres.log"
DB_NAME="backstack_verify"
KEEP="${BACKSTACK_KEEP_CLUSTER:-0}"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
fail()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }
ok()    { printf '\033[32m%s\033[0m\n' "$*"; }

if [ ! -x "$PGBIN/initdb" ]; then
  fail "No Postgres 16 server binaries at $PGBIN. Set PGBIN, or install postgresql-16."
  exit 1
fi

# initdb refuses to run as root, so the server runs as the postgres OS user
# while psql (a client) runs as whoever invoked the script.
AS_SERVER=()
if [ "$(id -u)" -eq 0 ]; then
  if ! id postgres >/dev/null 2>&1; then
    fail "Running as root and there is no 'postgres' OS user to drop into."
    exit 1
  fi
  AS_SERVER=(setpriv --reuid=postgres --regid=postgres --clear-groups)
fi

server() {
  if [ "${#AS_SERVER[@]}" -gt 0 ]; then "${AS_SERVER[@]}" "$@"; else "$@"; fi
}

cleanup() {
  local code=$?
  if [ "$KEEP" = "1" ] && [ "$code" -eq 0 ]; then
    bold "Cluster left running:"
    echo "  psql -h $SOCK_DIR -U postgres $DB_NAME"
    echo "  stop it with: ${AS_SERVER[*]:-} $PGBIN/pg_ctl -D $DATA_DIR stop"
    return
  fi
  if [ -d "$DATA_DIR" ]; then
    server "$PGBIN/pg_ctl" -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$CLUSTER_DIR"
}
trap cleanup EXIT

mkdir -p "$DATA_DIR" "$SOCK_DIR"
if [ "$(id -u)" -eq 0 ]; then
  chown -R postgres:postgres "$CLUSTER_DIR"
  chmod 0777 "$SOCK_DIR"
fi

bold "1. initdb"
server "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null

bold "2. start"
server "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" \
  -o "-k $SOCK_DIR -c listen_addresses='' -c log_min_messages=warning -c wal_level=logical" \
  -w start >/dev/null

export PGHOST="$SOCK_DIR"
export PGUSER=postgres
PSQL=(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -X)

"${PSQL[@]}" -d postgres -c "create database $DB_NAME" >/dev/null

run_sql() {
  "${PSQL[@]}" -d "$DB_NAME" -f "$1"
}

bold "3. auth/storage shim (local only)"
run_sql "$REPO_ROOT/supabase/local/00_auth_shim.sql" >/dev/null

bold "4. migrations"
shopt -s nullglob
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  printf '   %s\n' "$(basename "$f")"
  run_sql "$f" >/dev/null
done

bold "5. seed"
run_sql "$REPO_ROOT/supabase/seed.sql" >/dev/null

bold "6. test helpers"
run_sql "$REPO_ROOT/supabase/tests/_helpers.sql" >/dev/null

bold "7. tests"
failures=0
for f in "$REPO_ROOT"/supabase/tests/*.sql; do
  name="$(basename "$f")"
  case "$name" in _*) continue ;; esac
  # Assertions report through NOTICE; the void return values are noise.
  # sed, not grep: grep exits 1 on no matches and pipefail would read that as
  # a test failure.
  if out="$(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc -X -t -A -d "$DB_NAME" -f "$f" 2>&1 \
              | sed '/^$/d')"; then
    printf '   \033[32mpass\033[0m  %s  (%s assertions)\n' "$name" "$(printf '%s\n' "$out" | grep -c 'NOTICE:  ok' || true)"
    if [ "${BACKSTACK_VERBOSE:-0}" = "1" ]; then
      printf '%s\n' "$out" | sed 's/^/         /'
    fi
  else
    printf '   \033[31mFAIL\033[0m  %s\n' "$name"
    printf '%s\n' "$out" | tail -25 | sed 's/^/         /'
    failures=$((failures + 1))
  fi
done

echo
if [ "$failures" -gt 0 ]; then
  fail "$failures test file(s) failed."
  exit 1
fi

ok "All test files passed."
