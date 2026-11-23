#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WWWROOT="$ROOT/src/KeePort.Api/wwwroot"

(cd "$ROOT/web/vault" && npm ci && npm run build)
(cd "$ROOT/web/admin" && npm ci && npm run build)

rm -rf "$WWWROOT"
mkdir -p "$WWWROOT/admin"
cp -r "$ROOT/web/vault/dist/." "$WWWROOT/"
cp -r "$ROOT/web/admin/dist/." "$WWWROOT/admin/"

echo "Built web clients into $WWWROOT"
