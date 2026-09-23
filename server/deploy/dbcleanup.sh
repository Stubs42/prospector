#!/usr/bin/env bash
# Retention/maintenance for the Prospector games database (the `games` table — see
# server/db.ts's schema; game_players cascades on delete, so nothing extra to clean there).
#
# Reads DATABASE_URL the same way the app does: from .env next to this script's repo checkout,
# unless overridden via $DATABASE_URL or --db-url.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../../.env}"

usage() {
  cat <<'USAGE'
Usage: dbcleanup.sh [options]

  -s, --status          Show game counts (finished / active / total) and exit
  -k, --keep DAYS       Delete FINISHED games whose last update is older than DAYS days
  -f, --force           With --keep: also delete ACTIVE (unfinished) games older than DAYS
  -y, --yes             Skip the confirmation prompt before deleting
      --db-url URL      Postgres connection string (overrides .env / $DATABASE_URL)
  -h, --help            Show this help

-s and -k can be combined (status is printed first, then the cleanup runs).

Examples:
  dbcleanup.sh --status
  dbcleanup.sh --keep 30                 # delete finished games untouched for 30+ days
  dbcleanup.sh --keep 90 --force         # ALSO delete abandoned/active games 90+ days old
USAGE
}

STATUS=0
KEEP_DAYS=""
FORCE=0
ASSUME_YES=0
DB_URL="${DATABASE_URL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    -s|--status) STATUS=1; shift ;;
    -k|--keep)
      [ $# -ge 2 ] || { echo "error: --keep requires a number of days" >&2; exit 2; }
      KEEP_DAYS="$2"; shift 2 ;;
    -f|--force) FORCE=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --db-url)
      [ $# -ge 2 ] || { echo "error: --db-url requires a value" >&2; exit 2; }
      DB_URL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$DB_URL" ] && [ -f "$ENV_FILE" ]; then
  # strip a leading "DATABASE_URL=" and any surrounding quotes the .env line might have
  DB_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//")"
fi
if [ -z "$DB_URL" ]; then
  echo "error: no DATABASE_URL found (checked \$DATABASE_URL, --db-url, and $ENV_FILE)" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH (install the postgresql-client package)" >&2
  exit 1
fi

if [ "$FORCE" = 1 ] && [ -z "$KEEP_DAYS" ]; then
  echo "error: --force only makes sense together with --keep DAYS" >&2
  exit 2
fi
if [ "$STATUS" = 0 ] && [ -z "$KEEP_DAYS" ]; then
  usage
  exit 0
fi

# tuples-only, unaligned, field separator '|' (psql's default for -A) — for parsing results
psql_data() {
  psql "$DB_URL" -X -q -A -t -c "$1"
}

show_status() {
  local row finished active total oldest newest
  row="$(psql_data "
    select
      count(*) filter (where (state->>'gameOver')::boolean),
      count(*) filter (where not (state->>'gameOver')::boolean),
      count(*),
      coalesce(to_char(min(created_at), 'YYYY-MM-DD'), 'n/a'),
      coalesce(to_char(max(updated_at), 'YYYY-MM-DD'), 'n/a')
    from games;
  ")"
  IFS='|' read -r finished active total oldest newest <<< "$row"
  echo "Games in database:"
  echo "  finished : $finished"
  echo "  active   : $active"
  echo "  total    : $total"
  if [ "$total" != "0" ]; then
    echo "  oldest created     : $oldest"
    echo "  most recent update : $newest"
  fi
}

if [ "$STATUS" = 1 ]; then
  show_status
  [ -z "$KEEP_DAYS" ] && exit 0
  echo
fi

if [ -n "$KEEP_DAYS" ]; then
  case "$KEEP_DAYS" in
    ''|*[!0-9]*) echo "error: --keep expects a whole number of days, got '$KEEP_DAYS'" >&2; exit 2 ;;
  esac

  if [ "$FORCE" = 1 ]; then
    WHERE_CLAUSE="updated_at < now() - interval '$KEEP_DAYS days'"
    DESCRIPTION="ALL games (finished or still active) untouched for ${KEEP_DAYS}+ days"
  else
    WHERE_CLAUSE="(state->>'gameOver')::boolean and updated_at < now() - interval '$KEEP_DAYS days'"
    DESCRIPTION="FINISHED games untouched for ${KEEP_DAYS}+ days"
  fi

  COUNT="$(psql_data "select count(*) from games where $WHERE_CLAUSE;")"
  echo "$DESCRIPTION: $COUNT game(s) match."
  if [ "$COUNT" = "0" ]; then
    exit 0
  fi

  echo
  echo "Sample (oldest first, up to 10):"
  psql "$DB_URL" -c "
    select room_code, (state->>'gameOver')::boolean as finished, created_at, updated_at
    from games where $WHERE_CLAUSE
    order by updated_at asc limit 10;
  "
  echo

  if [ "$ASSUME_YES" != 1 ]; then
    # `|| REPLY=""` matters under `set -e`: read fails (non-zero) on EOF/no-stdin (e.g. a
    # non-interactive run without --yes) — without this, that failure would abort the whole
    # script here instead of falling through to the "Aborted" case below
    read -r -p "Delete these $COUNT game(s)? This cannot be undone. [y/N] " REPLY || REPLY=""
    case "$REPLY" in
      y|Y|yes|YES) ;;
      *) echo "Aborted — nothing deleted."; exit 0 ;;
    esac
  fi

  DELETED="$(psql_data "delete from games where $WHERE_CLAUSE returning 1;" | grep -c '^1$' || true)"
  echo "Deleted $DELETED game(s)."
fi
