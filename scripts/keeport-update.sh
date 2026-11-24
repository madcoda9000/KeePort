#!/usr/bin/env bash
# Updates a KeePort installation to a release from GitHub (Synology DSM, QNAP, or any Docker host).
#
# Usage:   sudo bash keeport-update.sh            -> latest release
#          sudo bash keeport-update.sh v0.6.0     -> a specific release
# Options (environment variables):
#   BASE_DIR=/volume1/docker   folder that contains the KeePort folder (QNAP: /share/Container)
#   APP_NAME=keeport           name of the KeePort folder (= Compose project name)
#   YES=1                      no confirmation prompt (e.g. for a scheduled task)
#   FORCE=1                    install even if the version is already running
#   HEALTH_TIMEOUT=300         seconds to wait for the container to become healthy
#
# What it does: backs up the data, puts the new release next to the old one, keeps your .env and data,
# rebuilds and starts KeePort, and restores the previous version automatically if the update fails.
# It never deletes anything; cleanup commands are printed at the end.
set -euo pipefail

BASE_DIR="${BASE_DIR:-/volume1/docker}"
APP_NAME="${APP_NAME:-keeport}"
REPO="madcoda9000/KeePort"
CONTAINER="keeport"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

APP_DIR="$BASE_DIR/$APP_NAME"
BACKUP_DIR="$BASE_DIR/keeport-backups"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Prints a progress message.
info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
# Prints a warning to stderr.
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*" >&2; }
# Prints an error to stderr and exits.
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Requirements ------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo bash $0 [vX.Y.Z]"
[ -f "$APP_DIR/docker-compose.yml" ] || die "No KeePort installation in $APP_DIR (adjust BASE_DIR/APP_NAME)."
[ -f "$APP_DIR/.env" ] || die "$APP_DIR/.env is missing."
command -v curl >/dev/null || die "curl was not found."
command -v docker >/dev/null || die "docker was not found (Container Manager / Container Station installed?)."

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null; then
  COMPOSE=(docker-compose)
else
  die "Neither 'docker compose' nor 'docker-compose' was found."
fi

# Runs docker compose in the given project folder.
compose() { local dir="$1"; shift; (cd "$dir" && "${COMPOSE[@]}" "$@"); }

# --- Versions ----------------------------------------------------------------
CURRENT="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$APP_DIR/web/vault/package.json" 2>/dev/null | head -1)"
CURRENT="${CURRENT:-unknown}"

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # /releases/latest ignores pre-releases, so take the newest entry of the list.
  TARGET="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" \
    | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -1)" || true
  [ -n "$TARGET" ] || die "Could not determine the latest release. Pass a version, e.g.: sudo bash $0 v0.6.0"
fi
case "$TARGET" in v*) ;; *) TARGET="v$TARGET" ;; esac

info "Installed: v$CURRENT   ->   target: $TARGET"
if [ "v$CURRENT" = "$TARGET" ] && [ "${FORCE:-0}" != "1" ]; then
  info "KeePort already runs $TARGET. (FORCE=1 reinstalls it.)"
  exit 0
fi

# --- Data location from .env -------------------------------------------------
KEEPORT_DATA="$(sed -nE 's/^[[:space:]]*KEEPORT_DATA=(.*)$/\1/p' "$APP_DIR/.env" | tail -1 | tr -d "\"' \r")"
DATA_INSIDE_APP=""   # relative path if the data lives inside the app folder (e.g. ./data)
case "$KEEPORT_DATA" in
  ""|keeport-data) DATA_KIND="volume"; VOLUME="${APP_NAME}_keeport-data" ;;
  /*)              DATA_KIND="folder"; DATA_PATH="$KEEPORT_DATA" ;;
  ../*)            DATA_KIND="folder"; DATA_PATH="$APP_DIR/$KEEPORT_DATA" ;;
  ./*)             DATA_KIND="folder"; DATA_INSIDE_APP="${KEEPORT_DATA#./}"; DATA_PATH="$APP_DIR/$DATA_INSIDE_APP" ;;
  *)               DATA_KIND="volume"; VOLUME="${APP_NAME}_${KEEPORT_DATA}" ;;
esac

if [ "$DATA_KIND" = "volume" ]; then
  docker volume inspect "$VOLUME" >/dev/null 2>&1 || die "Docker volume $VOLUME not found - where is the data? (check KEEPORT_DATA in .env)"
  info "Data: Docker volume $VOLUME"
  warn "Your data is in a Docker volume. NAS backup tools such as Hyper Backup or Hybrid Backup Sync don't include it."
  warn "To change that, see DEPLOYMENT.md -> 'Move data from the Docker volume to a folder'."
else
  [ -f "$DATA_PATH/keeport.db" ] || die "No keeport.db in $DATA_PATH (check KEEPORT_DATA in .env)."
  info "Data: folder $DATA_PATH"
fi

if [ "${YES:-0}" != "1" ]; then
  read -r -p "KeePort will be stopped briefly, backed up and updated. Continue? [y/N] " answer
  case "$answer" in y|Y|yes|Yes|j|J|ja|Ja) ;; *) info "Cancelled."; exit 0 ;; esac
fi

# --- Download the release ----------------------------------------------------
TMP="$(mktemp -d "$BASE_DIR/.keeport-update.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

info "Downloading $TARGET"
curl -fL --progress-bar "https://github.com/$REPO/archive/refs/tags/$TARGET.tar.gz" -o "$TMP/release.tar.gz" \
  || die "Download failed - does the release $TARGET exist?"
tar xzf "$TMP/release.tar.gz" -C "$TMP"
NEW_SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$NEW_SRC" ] && [ -f "$NEW_SRC/docker-compose.yml" ] || die "The archive does not contain a KeePort release."

# --- Stop and back up ---------------------------------------------------------
info "Stopping KeePort"
compose "$APP_DIR" stop

mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/keeport-data-v$CURRENT-$STAMP.tgz"
info "Backing up the data to $BACKUP_FILE"
if [ "$DATA_KIND" = "volume" ]; then
  docker run --rm -v "$VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine \
    tar czf "/backup/$(basename "$BACKUP_FILE")" -C /data . \
    || { compose "$APP_DIR" start; die "Backup failed - KeePort keeps running unchanged."; }
else
  tar czf "$BACKUP_FILE" -C "$DATA_PATH" . \
    || { compose "$APP_DIR" start; die "Backup failed - KeePort keeps running unchanged."; }
fi

# --- Swap the folders ---------------------------------------------------------
OLD_DIR="$BASE_DIR/$APP_NAME-old-v$CURRENT-$STAMP"
info "Moving the previous version to $OLD_DIR"
mv "$APP_DIR" "$OLD_DIR"
mv "$NEW_SRC" "$APP_DIR"
cp -p "$OLD_DIR/.env" "$APP_DIR/.env"
# Removed in 0.2.1; a wrong value made the admin console unreachable.
sed -i '/^[#[:space:]]*KEEPORT_ADMIN_PORT=/d' "$APP_DIR/.env"
if [ -n "$DATA_INSIDE_APP" ]; then
  mkdir -p "$(dirname "$APP_DIR/$DATA_INSIDE_APP")"
  mv "$OLD_DIR/$DATA_INSIDE_APP" "$APP_DIR/$DATA_INSIDE_APP"
fi

# Restores the previous version after a failed update and exits.
rollback() {
  warn "$1 - restoring v$CURRENT"
  compose "$APP_DIR" logs --tail 40 "$CONTAINER" || true
  compose "$APP_DIR" down || true
  if [ -n "$DATA_INSIDE_APP" ]; then
    mv "$APP_DIR/$DATA_INSIDE_APP" "$OLD_DIR/$DATA_INSIDE_APP"
  fi
  mv "$APP_DIR" "$BASE_DIR/$APP_NAME-failed-$TARGET-$STAMP"
  mv "$OLD_DIR" "$APP_DIR"
  compose "$APP_DIR" up -d --build || warn "The previous version does not start either - check the logs."
  die "Update to $TARGET failed. v$CURRENT is running again. Data backup: $BACKUP_FILE"
}

# --- Build, start, check health -----------------------------------------------
info "Building and starting $TARGET (this takes a few minutes)"
compose "$APP_DIR" up -d --build || rollback "Build or start failed"

info "Waiting for KeePort to become ready (up to ${HEALTH_TIMEOUT}s)"
status="unknown"
for ((waited = 0; waited < HEALTH_TIMEOUT; waited += 5)); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER" 2>/dev/null || echo missing)"
  [ "$status" = "healthy" ] && break
  if [ "$(docker inspect -f '{{.RestartCount}}' "$CONTAINER" 2>/dev/null || echo 0)" -ge 3 ]; then
    rollback "The container keeps restarting"
  fi
  sleep 5
done
[ "$status" = "healthy" ] || rollback "KeePort did not become ready in time (status: $status)"

# --- Result --------------------------------------------------------------------
NOW="$(sed -nE 's/^[[:space:]]*"version":[[:space:]]*"([^"]+)".*/\1/p' "$APP_DIR/web/vault/package.json" | head -1)"
info "Done: KeePort v$NOW is running."
echo
echo "  Data backup:        $BACKUP_FILE"
echo "  Previous version:   $OLD_DIR"
echo
echo "  When everything works, clean up with:"
echo "    sudo rm -rf \"$OLD_DIR\""
echo "    sudo docker image prune -f     # removes unused old images"
