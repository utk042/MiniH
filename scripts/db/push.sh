#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Applies supabase/migrations/*.sql to a real database, in order.
#
#   SUPABASE_DB_URL=postgresql://... npm run db:push
#   SUPABASE_DB_URL=postgresql://... npm run db:push -- --seed
#
# Use this when you are not running the Supabase CLI. If you are, prefer
# `supabase db push` and `supabase db reset`, which track applied migrations.
# This script does not: it applies every file every time, so the migrations
# have to be safe to re-apply, or the database has to be fresh.
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WITH_SEED=0
for arg in "$@"; do
  case "$arg" in
    --seed) WITH_SEED=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set. See .env.example." >&2
  exit 1
fi

# Never point this at the verification cluster's database by accident.
case "$SUPABASE_DB_URL" in
  *backstack_verify*) echo "SUPABASE_DB_URL points at the throwaway verify database." >&2; exit 1 ;;
esac

echo "Target: $(printf '%s' "$SUPABASE_DB_URL" | sed 's#://[^@]*@#://***@#')"
read -r -p "Apply all migrations to that database? [y/N] " reply
case "$reply" in y|Y) ;; *) echo "Nothing applied."; exit 0 ;; esac

shopt -s nullglob
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "  $(basename "$f")"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -X -f "$f"
done

if [ "$WITH_SEED" = "1" ]; then
  echo
  echo "The seed inserts 25 accounts into auth.users and will fail on a database"
  echo "that already has them."
  read -r -p "Apply supabase/seed.sql as well? [y/N] " reply
  case "$reply" in
    y|Y) psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --quiet --no-psqlrc -X -f "$REPO_ROOT/supabase/seed.sql" ;;
    *) echo "Seed skipped." ;;
  esac
fi

echo "Done."
