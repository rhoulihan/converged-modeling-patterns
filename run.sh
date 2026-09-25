#!/usr/bin/env bash
# ============================================================================
# One command: bring up Oracle AI Database 26ai Free and run every pattern's SQL.
#
#   ./run.sh                # bring up the DB and run all six patterns
#   ./run.sh 03-bucket      # run just one pattern (dir name under patterns/)
#
# Every .sql prints its result and is graded: a script that raises any ORA-/PLS-
# error exits non-zero (WHENEVER SQLERROR) and is reported as FAIL. Idempotent —
# rerun as often as you like.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

ORACLE_PASSWORD="${ORACLE_PASSWORD:-Sandbox2026}"
CMP_PASSWORD="${CMP_PASSWORD:-CmpUser2026}"
SVC=oracle
ADMIN="system/${ORACLE_PASSWORD}@localhost:1521/FREEPDB1"
APP="cmp_user/${CMP_PASSWORD}@localhost:1521/FREEPDB1"
FILTER="${1:-}"

echo "==> Bringing up Oracle AI Database 26ai Free (docker compose up -d) ..."
ORACLE_PASSWORD="$ORACLE_PASSWORD" CMP_PASSWORD="$CMP_PASSWORD" docker compose up -d

echo -n "==> Waiting for the database to accept connections "
until docker compose exec -T "$SVC" bash -lc \
        "echo 'select 1 from dual;' | sqlplus -s -L $ADMIN" 2>/dev/null \
        | grep -q '^[[:space:]]*1'; do
  echo -n '.'; sleep 5
done
echo " ready."

echo "==> Granting the schema privileges the patterns use (idempotent) ..."
docker compose exec -T "$SVC" bash -lc "sqlplus -s -L $ADMIN" >/dev/null <<'SQL'
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER,
      CREATE SEQUENCE, CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH, SODA_APP TO cmp_user;
ALTER USER cmp_user QUOTA UNLIMITED ON users;
EXIT
SQL

pass=0; fail=0; failed_files=""
for d in patterns/*/; do
  name="$(basename "$d")"
  [ -n "$FILTER" ] && [ "$name" != "$FILTER" ] && continue
  echo ""
  echo "################  $name  ################"
  for f in "$d"01-document-model.sql "$d"02-converged.sql; do
    [ -f "$f" ] || continue
    echo "----------------  $f  ----------------"
    { echo "WHENEVER SQLERROR EXIT SQL.SQLCODE"; echo "SET PAGESIZE 50 LINESIZE 200 FEEDBACK ON LONG 6000"; cat "$f"; } \
      | docker compose exec -T "$SVC" bash -lc "sqlplus -s -L $APP"
    if [ "${PIPESTATUS[1]:-1}" -eq 0 ]; then
      echo "[PASS] $f"; pass=$((pass+1))
    else
      echo "[FAIL] $f"; fail=$((fail+1)); failed_files="$failed_files $f"
    fi
  done
done

echo ""
echo "==================================================================="
echo "  RESULT: $pass passed, $fail failed"
[ -n "$failed_files" ] && echo "  Failed:$failed_files"
echo "==================================================================="
[ "$fail" -eq 0 ]
