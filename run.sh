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
# Stage 3:   the lab console's vitest suites (app/), in a throwaway container. Skipped
#            while cmp-lab-ui runs in event mode (never run this during an event); if a
#            (solo) cmp-lab-ui is running it is restarted afterwards so its in-memory
#            dirty/built flags and result cache reload from the database.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

ORACLE_PASSWORD="${ORACLE_PASSWORD:-Sandbox2026}"
CMP_PASSWORD="${CMP_PASSWORD:-CmpUser2026}"
ADMIN="system/${ORACLE_PASSWORD}@localhost:1521/FREEPDB1"
APP="cmp_user/${CMP_PASSWORD}@localhost:1521/FREEPDB1"
# $external must reach mongosh literally, so it is escaped for the host shell here
# and expanded only inside the container as the value of $MURI.
MURI="mongodb://cmp_user:${CMP_PASSWORD}@localhost:27017/CMP_USER?authMechanism=PLAIN&authSource=\$external&retryWrites=false&loadBalanced=true"
FILTER="${1:-}"

# Container CLI for exec/inspect: docker, else podman (CONTAINER_ENGINE overrides).
# The stack itself comes up through compose when a provider is available, otherwise
# through ./lab.sh, which runs the same services with the plain CLI (Podman, no compose).
CLI="${CONTAINER_ENGINE:-$(command -v docker >/dev/null && echo docker || echo podman)}"
if   docker compose version >/dev/null 2>&1; then COMPOSE="docker compose"
elif podman compose version >/dev/null 2>&1; then COMPOSE="podman compose"
else COMPOSE=""; fi

dexec()  { "$CLI" exec -i cmp-oracle bash -lc "$1"; }                  # in-container bash
sqlpipe(){ "$CLI" exec -i cmp-oracle bash -lc "sqlplus -s -L $APP"; }  # stdin -> sqlplus

# Record the console's state BEFORE compose touches anything (stage 3 depends on it).
ui_event() {  # true when cmp-lab-ui is running with LAB_MODE=event
  [ "$("$CLI" inspect -f '{{.State.Running}}' cmp-lab-ui 2>/dev/null)" = true ] &&
    "$CLI" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' cmp-lab-ui 2>/dev/null | grep -qx 'LAB_MODE=event'
}
ui_event_at_start=0; ui_event && ui_event_at_start=1

if [ -n "$COMPOSE" ]; then
  echo "==> Bringing up the stack ($COMPOSE up -d) ..."
  ORACLE_PASSWORD="$ORACLE_PASSWORD" CMP_PASSWORD="$CMP_PASSWORD" $COMPOSE up -d
else
  echo "==> Bringing up the stack (./lab.sh up: no compose provider, plain $CLI) ..."
  ORACLE_PASSWORD="$ORACLE_PASSWORD" CMP_PASSWORD="$CMP_PASSWORD" ./lab.sh up || exit 1
fi

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
  if "$CLI" exec -i -e MURI="$MURI" cmp-oracle bash -lc \
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
  "$CLI" exec -i -e MURI="$MURI" -e SQL_RESULT="$sqlr" cmp-oracle \
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
  if [ "$ui_event_at_start" = 1 ] || ui_event; then
    echo "     [SKIP] lab-ui tests: cmp-lab-ui is running in EVENT mode. The integration tests"
    echo "            share its database; run them after the event (see docs/instructor-runbook.md)."
  else
    # --no-deps: stage 1 already brought the database up; never recreate it from here.
    if [ -n "$COMPOSE" ]; then
      lab_tests() { $COMPOSE --profile test build lab-ui-test && $COMPOSE --profile test run --rm --no-deps lab-ui-test; }
    else
      lab_tests() { ORACLE_PASSWORD="$ORACLE_PASSWORD" CMP_PASSWORD="$CMP_PASSWORD" ./lab.sh test; }
    fi
    if lab_tests; then
      echo "     [PASS] lab-ui tests"; pass=$((pass+1))
    else
      echo "     [FAIL] lab-ui tests"; fail=$((fail+1)); failed="$failed lab-ui-tests"
    fi
    if [ "$("$CLI" inspect -f '{{.State.Running}}' cmp-lab-ui 2>/dev/null)" = true ]; then
      echo "==> Restarting lab-ui so it reloads its dirty/built flags and cache ..."
      "$CLI" restart cmp-lab-ui >/dev/null
    fi
  fi
fi

echo ""; echo "==================================================================="
echo "  RESULT: $pass passed, $fail failed  (SQL + MongoDB lanes)"
[ -n "$failed" ] && echo "  Failed:$failed"
echo "==================================================================="
[ "$fail" -eq 0 ]
