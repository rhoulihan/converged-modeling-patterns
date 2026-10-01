#!/usr/bin/env bash
# ============================================================================
# Compose-free launcher: runs the same stack as compose.yml with the plain
# container CLI, so the lab works on Podman with no compose provider installed
# (and on a bare Docker engine too).
#
#   ./lab.sh up [--build]    # build images if missing (or always, with --build), start both services
#   ./lab.sh down [-v]       # remove the containers; -v also DELETES the database volume
#   ./lab.sh status          # containers, health, console URL
#   ./lab.sh logs [oracle|lab-ui] [podman logs flags...]
#   ./lab.sh test            # the lab console's vitest suites (run.sh stage 3 uses this)
#
# Engine: podman if installed, else docker. Override with CONTAINER_ENGINE=docker.
# Settings come from .env (same keys as compose.yml); a variable already set in the
# shell wins over .env, as with compose.
#
# KEEP IN STEP WITH compose.yml. compose.yml is the source of truth; this script
# mirrors its images, container names, ports, environment and volume. It uses the
# same volume and network names compose would create, so the database survives a
# switch between the two (remove the containers with one before starting the other:
# the container names are fixed).
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")"

ENGINE="${CONTAINER_ENGINE:-$(command -v podman >/dev/null && echo podman || echo docker)}"
PROJECT=converged-modeling-patterns
NET="${PROJECT}_default"
VOL="${PROJECT}_cmp-data"
DB=cmp-oracle
UI=cmp-lab-ui
IMG_DB="${PROJECT}-oracle:latest"
IMG_UI="${PROJECT}-lab-ui:latest"
IMG_TEST="${PROJECT}-lab-ui-test:latest"

# .env: KEY=VALUE lines, no shell evaluation. The shell environment wins.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
    [ -z "${!key+x}" ] && export "$key=$val"
  done < .env
fi

# compose.yml defaults
: "${CMP_DB_BIND:=127.0.0.1}" "${CMP_PORT:=1522}" "${CMP_ORDS_PORT:=8182}" "${CMP_MONGO_PORT:=27018}"
: "${CMP_UI_BIND:=127.0.0.1}" "${CMP_UI_PORT:=3100}"
: "${ORACLE_PASSWORD:=Sandbox2026}" "${CMP_PASSWORD:=CmpUser2026}" "${LAB_ADMIN_PASSWORD:=LabAdmin2026}"
: "${LAB_MODE:=solo}" "${ADMIN_PASSWORD:=}" "${EVENT_CODE:=}" "${DB_POOL_MAX:=1}" "${MONGO_POOL_MAX:=1}"

e()        { "$ENGINE" "$@"; }
exists()   { e container inspect "$1" >/dev/null 2>&1; }
running()  { [ "$(e container inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
has_img()  { e image inspect "$1" >/dev/null 2>&1; }

build() {  # $1 = force (1/0)
  if [ "$1" = 1 ] || ! has_img "$IMG_DB"; then
    echo "==> Building $IMG_DB (first build pulls the 26ai Free base image: several minutes) ..."
    e build -t "$IMG_DB" -f docker/Dockerfile docker || exit 1
  fi
  if [ "$1" = 1 ] || ! has_img "$IMG_UI"; then
    echo "==> Building $IMG_UI ..."
    e build -t "$IMG_UI" -f app/Dockerfile --target runtime . || exit 1
  fi
}

ensure_net_vol() {
  # compose's own labels, so a later `compose up` adopts these instead of warning
  local p=(--label "com.docker.compose.project=$PROJECT")
  e network inspect "$NET" >/dev/null 2>&1 || e network create "${p[@]}" --label com.docker.compose.network=default "$NET" >/dev/null || exit 1
  e volume inspect "$VOL" >/dev/null 2>&1 || e volume create "${p[@]}" --label com.docker.compose.volume=cmp-data "$VOL" >/dev/null || exit 1
}

start_db() {
  if running "$DB"; then return; fi
  if exists "$DB"; then echo "==> Starting $DB ..."; e start "$DB" >/dev/null || exit 1; return; fi
  echo "==> Creating $DB ..."
  e run -d --name "$DB" --network "$NET" --network-alias oracle \
    -p "$CMP_DB_BIND:$CMP_PORT:1521" -p "$CMP_DB_BIND:$CMP_ORDS_PORT:8181" -p "$CMP_DB_BIND:$CMP_MONGO_PORT:27017" \
    -e ORACLE_PASSWORD="$ORACLE_PASSWORD" -e APP_USER=CMP_USER -e APP_USER_PASSWORD="$CMP_PASSWORD" \
    --health-cmd healthcheck.sh --health-interval 10s --health-timeout 10s --health-retries 60 --health-start-period 180s \
    -v "$VOL:/opt/oracle/oradata" \
    "$IMG_DB" >/dev/null || exit 1
}

wait_db() {  # compose's depends_on: service_healthy, done by polling the same check
  echo -n "==> Waiting for the database to be healthy "
  for _ in $(seq 1 120); do
    e exec "$DB" healthcheck.sh >/dev/null 2>&1 && { echo " ready."; return; }
    running "$DB" || { echo " $DB stopped. See: ./lab.sh logs oracle"; exit 1; }
    echo -n '.'; sleep 5
  done
  echo " timed out after 10 minutes. See: ./lab.sh logs oracle"; exit 1
}

ui_env=(LAB_MODE ADMIN_PASSWORD EVENT_CODE ORACLE_PASSWORD CMP_PASSWORD LAB_ADMIN_PASSWORD DB_POOL_MAX MONGO_POOL_MAX)
ui_config() {  # fingerprint of everything that should force a console recreate (compose recreates on change)
  { for k in "${ui_env[@]}"; do printf '%s=%s\n' "$k" "${!k}"; done
    echo "$CMP_UI_BIND:$CMP_UI_PORT"; e image inspect -f '{{.Id}}' "$IMG_UI"; } | cksum | cut -d' ' -f1
}

start_ui() {
  local want; want="$(ui_config)"
  if exists "$UI"; then
    if [ "$(e container inspect -f '{{index .Config.Labels "cmp.config"}}' "$UI" 2>/dev/null)" = "$want" ]; then
      running "$UI" || { echo "==> Starting $UI ..."; e start "$UI" >/dev/null || exit 1; }
      return
    fi
    echo "==> Settings changed: recreating $UI ..."; e rm -f "$UI" >/dev/null
  else
    echo "==> Creating $UI ..."
  fi
  local args=(); for k in "${ui_env[@]}"; do args+=(-e "$k=${!k}"); done
  e run -d --name "$UI" --network "$NET" --label "cmp.config=$want" \
    -p "$CMP_UI_BIND:$CMP_UI_PORT:3000" "${args[@]}" "$IMG_UI" >/dev/null || exit 1
}

status() {
  e ps -a --filter "name=^($DB|$UI)\$" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
  running "$UI" && echo "Console: http://localhost:$CMP_UI_PORT   Admin: http://localhost:$CMP_UI_PORT/admin.html   (mode: $LAB_MODE)"
}

case "${1:-}" in
  up)
    [ "$LAB_MODE" = event ] && [ -z "$ADMIN_PASSWORD" ] && { echo "LAB_MODE=event needs ADMIN_PASSWORD (set it in .env)."; exit 1; }
    build "$([ "${2:-}" = --build ] && echo 1 || echo 0)"
    ensure_net_vol; start_db; wait_db; start_ui; status ;;
  down)
    e rm -f "$UI" "$DB" >/dev/null 2>&1
    if [ "${2:-}" = -v ]; then e volume rm "$VOL" >/dev/null 2>&1 && echo "Removed containers and the database volume."
    else echo "Removed containers (database volume kept; add -v to delete it)."; fi ;;
  status) status ;;
  logs)
    svc="${2:-oracle}"; shift $(( $# >= 2 ? 2 : 1 ))
    case "$svc" in oracle) e logs "$@" "$DB" ;; lab-ui) e logs "$@" "$UI" ;; *) echo "logs: oracle | lab-ui"; exit 1 ;; esac ;;
  test)
    running "$DB" || { echo "$DB is not running: ./lab.sh up first."; exit 1; }
    e build -t "$IMG_TEST" -f app/Dockerfile --target test . || exit 1
    e run --rm --network "$NET" \
      -e DB_HOST=oracle -e DB_PORT=1521 -e MONGO_HOST=oracle -e MONGO_PORT=27017 \
      -e ORACLE_PASSWORD="$ORACLE_PASSWORD" -e CMP_PASSWORD="$CMP_PASSWORD" -e LAB_ADMIN_PASSWORD="$LAB_ADMIN_PASSWORD" \
      "$IMG_TEST" ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
