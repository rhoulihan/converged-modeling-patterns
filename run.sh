#!/usr/bin/env bash
# ============================================================================
# One command: bring up Oracle AI Database 26ai Free (+ ORDS + the Oracle API for
# MongoDB) and validate every pattern across BOTH lanes.
#
#   ./run.sh                # bring up the DB and run all patterns, both lanes
#   ./run.sh 03-bucket      # run just one pattern (dir name under patterns/)
#
# SQL lane:   each *.sql runs through sqlplus. WHENEVER SQLERROR makes any ORA-/PLS-
#             error a non-zero exit -> reported FAIL.
# Mongo lane: each *.js runs through mongosh, in-container. A *parity.js compares the
#             SQL-lane result (captured from _capture.sql and injected as $SQL_RESULT)
#             against the same data read through the MongoDB API; it exits non-zero on
#             mismatch -> reported FAIL.
#
# Idempotent: rerun as often as you like. SQL-only patterns (no *.js) simply skip
# the Mongo lane.
#
# Stage 3:   the lab console's vitest suites (app/), in a throwaway container.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

ORACLE_PASSWORD="${ORACLE_PASSWORD:-Sandbox2026}"
CMP_PASSWORD="${CMP_PASSWORD:-CmpUser2026}"
SVC=oracle
ADMIN="system/${ORACLE_PASSWORD}@localhost:1521/FREEPDB1"
APP="cmp_user/${CMP_PASSWORD}@localhost:1521/FREEPDB1"
# $external must reach mongosh literally, so it is escaped for the host shell here
# and expanded only inside the container as the value of $MURI.
MURI="mongodb://cmp_user:${CMP_PASSWORD}@localhost:27017/CMP_USER?authMechanism=PLAIN&authSource=\$external&retryWrites=false&loadBalanced=true"
FILTER="${1:-}"

dexec()  { docker compose exec -T "$SVC" bash -lc "$1"; }          # in-container bash
sqlpipe(){ docker compose exec -T "$SVC" bash -lc "sqlplus -s -L $APP"; }  # stdin -> sqlplus

echo "==> Bringing up the stack (docker compose up -d) ..."
ORACLE_PASSWORD="$ORACLE_PASSWORD" CMP_PASSWORD="$CMP_PASSWORD" docker compose up -d

echo -n "==> Waiting for the database "
until dexec "echo 'select 1 from dual;' | sqlplus -s -L $ADMIN" 2>/dev/null | grep -q '^[[:space:]]*1'; do
  echo -n '.'; sleep 5
done
echo " ready."

echo "==> Granting schema privileges (idempotent) ..."
dexec "sqlplus -s -L $ADMIN" >/dev/null <<'SQL'
GRANT CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE TRIGGER,
      CREATE SEQUENCE, CREATE MATERIALIZED VIEW, CREATE PROPERTY GRAPH, SODA_APP TO cmp_user;
ALTER USER cmp_user QUOTA UNLIMITED ON users;
EXIT
SQL

echo -n "==> Waiting for the MongoDB API (ORDS) "
mongo_ok=0
for i in $(seq 1 60); do
  if docker compose exec -T -e MURI="$MURI" "$SVC" bash -lc \
       'echo "quit(0)" | mongosh "$MURI" --quiet --file /dev/stdin' >/dev/null 2>&1; then
    mongo_ok=1; break
  fi
  echo -n '.'; sleep 5
done
[ "$mongo_ok" = 1 ] && echo " ready." || echo " NOT ready (Mongo-lane scripts will FAIL and be reported)."

pass=0; fail=0; failed=""

run_sql() {  # $1 = file
  echo "---- [SQL]   $1"
  { echo "WHENEVER SQLERROR EXIT SQL.SQLCODE";
    echo "SET PAGESIZE 50 LINESIZE 200 FEEDBACK ON LONG 8000";
    cat "$1"; } | sqlpipe
  if [ "${PIPESTATUS[1]:-1}" -eq 0 ]; then echo "     [PASS] $1"; pass=$((pass+1));
  else echo "     [FAIL] $1"; fail=$((fail+1)); failed="$failed $1"; fi
}

run_js() {   # $1 = file, $2 = pattern dir
  local js="$1" dir="$2" sqlr=""
  echo "---- [MONGO] $js"
  if [[ "$js" == *parity.js && -f "$dir/_capture.sql" ]]; then
    sqlr=$(cat "$dir/_capture.sql" | sqlpipe 2>/dev/null | sed '/^[[:space:]]*$/d' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ -z "$sqlr" ]; then echo "     [FAIL] $js (SQL capture empty)"; fail=$((fail+1)); failed="$failed $js"; return; fi
  fi
  docker compose exec -T -e MURI="$MURI" -e SQL_RESULT="$sqlr" "$SVC" \
    bash -lc 'mongosh "$MURI" --quiet --file /dev/stdin' < "$js"
  if [ "$?" -eq 0 ]; then echo "     [PASS] $js"; pass=$((pass+1));
  else echo "     [FAIL] $js"; fail=$((fail+1)); failed="$failed $js"; fi
}

for d in patterns/*/; do
  name="$(basename "$d")"
  [ -n "$FILTER" ] && [ "$name" != "$FILTER" ] && continue
  echo ""; echo "################  $name  ################"
  # SQL lane first (creates the tables / duality views the Mongo lane reads).
  for f in "$d"01-document-model.sql "$d"02-converged.sql; do
    [ -f "$f" ] && run_sql "$f"
  done
  # Mongo lane, in filename order (01 doc-model, 02 sql-in-pipeline, 03 parity).
  for js in "$d"*.js; do
    [ -f "$js" ] && run_js "$js" "${d%/}"
  done
done

# Stage 3: the hands-on console's own tests (unit + integration) against this database.
# Skipped when a single pattern is requested.
if [ -z "$FILTER" ]; then
  echo ""; echo "################  lab console (app/)  ################"
  if docker compose --profile test build lab-ui-test && docker compose --profile test run --rm lab-ui-test; then
    echo "     [PASS] lab-ui tests"; pass=$((pass+1))
  else
    echo "     [FAIL] lab-ui tests"; fail=$((fail+1)); failed="$failed lab-ui-tests"
  fi
fi

echo ""; echo "==================================================================="
echo "  RESULT: $pass passed, $fail failed  (SQL + MongoDB lanes)"
[ -n "$failed" ] && echo "  Failed:$failed"
echo "==================================================================="
[ "$fail" -eq 0 ]
