#!/usr/bin/env bash
# Pi Calendar production install (M3). Prints the plan by default; changes the system only with --apply.
#   npm ci && npm run check && npm run build      # as the normal user first (non-root build)
#   sudo bash ops/install/install-production.sh            # dry run: show every action
#   sudo bash ops/install/install-production.sh --apply    # perform it
# Options: --import-dev-state DIR  copy oauth-client.json/tokens.json from a dev state dir (stop the dev worker first)
# Idempotent: existing runtime.env is kept; replaced unit files are backed up first.
set -euo pipefail

NODE_VERSION=v24.21.0
APP=/opt/pi-calendar
NODE_DIR="$APP/node-$NODE_VERSION"
NODE_BIN="$NODE_DIR/bin/node"
STATE=/var/lib/pi-calendar
ETC=/etc/pi-calendar
BACKUPS=/var/backups/pi-calendar
SERVICE_USER=calendar-app
UNIT_DIR=/etc/systemd/system
SRC="$(cd "$(dirname "$0")/../.." && pwd)"

apply=0; import_dir=''
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --import-dev-state) import_dir="${2:?--import-dev-state needs a directory}"; shift ;;
    --help|-h) sed -n '2,8p' "$0"; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
run() { # Show the command; execute it only with --apply.
  printf '  + %s\n' "$*"
  if [ "$apply" -eq 1 ]; then "$@"; fi
}
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# ---- preflight (read-only) ----
[ "$(uname -m)" = aarch64 ] || fail 'Linux arm64 (aarch64) only.'
[ -f "$SRC/dist/web/server.js" ] && [ -f "$SRC/dist/worker.mjs" ] && [ -f "$SRC/dist/cli.mjs" ] || fail 'Build first as the normal user: npm ci && npm run build'
if [ "$apply" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then fail 'Run with sudo for --apply.'; fi
if ! git -C "$SRC" diff --quiet HEAD -- 2>/dev/null; then
  if [ "$apply" -eq 1 ]; then fail 'Working tree has uncommitted changes; install only committed code.'; fi
  printf 'WARNING: uncommitted changes; --apply will refuse until they are committed.\n'
fi
commit=$(git -C "$SRC" rev-parse HEAD)
release_id="$(date -u +%Y%m%d%H%M%S)-${commit:0:12}"
release="$APP/releases/$release_id"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
if [ -n "$import_dir" ]; then
  import_dir=$(cd "$import_dir" && pwd)
  [ -f "$import_dir/secrets/oauth-client.json" ] && [ -f "$import_dir/secrets/tokens.json" ] || fail "No secrets/oauth-client.json + secrets/tokens.json under $import_dir"
fi

say "Pi Calendar production install — $([ "$apply" -eq 1 ] && echo APPLY || echo 'DRY RUN (nothing is changed; add --apply)')"
say "  commit $commit → release $release_id"
say ''

say '1. Root-managed Node.js (systemd must not use ~/.local; ProtectHome=true)'
if [ -x "$NODE_BIN" ] && [ "$("$NODE_BIN" --version)" = "$NODE_VERSION" ]; then say "  = $NODE_BIN already installed"
else
  if [ "$apply" -eq 1 ]; then tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT; else tmp='<tmpdir>'; fi
  tarball="node-$NODE_VERSION-linux-arm64.tar.xz"
  run curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  run curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  printf '  + (cd %s && grep " %s$" SHASUMS256.txt | sha256sum -c -)\n' "$tmp" "$tarball"
  if [ "$apply" -eq 1 ]; then (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -); fi
  run install -d -o root -g root -m 0755 "$NODE_DIR"
  run tar -xJf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1 --no-same-owner
fi

say '2. Dedicated non-root service user'
if id "$SERVICE_USER" >/dev/null 2>&1; then say "  = user $SERVICE_USER exists"
else run useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"; fi

say '3. Directories'
run install -d -o root -g root -m 0755 "$APP" "$APP/releases"
run install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$STATE" "$STATE/secrets" "$STATE/locks"
run install -d -o root -g "$SERVICE_USER" -m 0750 "$ETC"
run install -d -o root -g root -m 0700 "$BACKUPS"

say "4. Release $release_id (root-owned, read-only for the service)"
run install -d -o root -g root -m 0755 "$release"
run cp -a "$SRC/dist" "$release/dist"
run chown -R root:root "$release"
run chmod -R go-w,a+rX "$release"
manifest=$(printf '{"formatVersion":1,"releaseId":"%s","commit":"%s","builtAt":"%s","platform":"linux","arch":"arm64","nodeVersion":"%s","schema":{"target":1}}' "$release_id" "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$NODE_VERSION")
printf '  + write %s/release.json\n' "$release"
if [ "$apply" -eq 1 ]; then printf '%s\n' "$manifest" > "$release/release.json"; chmod 0644 "$release/release.json"; fi
# Atomic switch: new symlink, then rename over "current". Keep the old target as "previous".
if [ -L "$APP/current" ]; then run ln -sfn "$(readlink "$APP/current")" "$APP/previous"; fi
run ln -sfn "$release" "$APP/current.new"
run mv -T "$APP/current.new" "$APP/current"

say '5. Runtime configuration'
if [ -f "$ETC/runtime.env" ]; then say "  = $ETC/runtime.env kept as is"
else run install -o root -g "$SERVICE_USER" -m 0640 "$SRC/ops/runtime.env.example" "$ETC/runtime.env"; fi

if [ -n "$import_dir" ]; then
  say "6. Import Google client/token from $import_dir (values are not printed)"
  for f in oauth-client.json tokens.json; do
    if [ -f "$STATE/secrets/$f" ]; then run cp -a "$STATE/secrets/$f" "$BACKUPS/$f.$stamp.bak"; fi
    run install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0600 "$import_dir/secrets/$f" "$STATE/secrets/$f"
  done
else
  say '6. Google credentials: not imported (authenticate later with: sudo pi-calendar auth google)'
fi

say '7. CLI wrapper /usr/local/bin/pi-calendar (runs the CLI as the service user)'
run install -o root -g root -m 0755 "$SRC/ops/install/pi-calendar-cli.sh" /usr/local/bin/pi-calendar

say '8. systemd units'
for name in pi-calendar-web pi-calendar-sync; do
  target="$UNIT_DIR/$name.service"
  rendered=$(sed "s#@NODE_BIN@#$NODE_BIN#g" "$SRC/ops/systemd/$name.service.in")
  if [ -f "$target" ] && [ "$(cat "$target")" = "$rendered" ]; then say "  = $target unchanged"; continue; fi
  if [ -f "$target" ]; then run cp -a "$target" "$BACKUPS/$name.service.$stamp.bak"; fi
  printf '  + write %s\n' "$target"
  if [ "$apply" -eq 1 ]; then printf '%s\n' "$rendered" > "$target"; chmod 0644 "$target"; fi
done
run systemctl daemon-reload
run systemctl enable pi-calendar-web.service pi-calendar-sync.service
run systemctl restart pi-calendar-web.service pi-calendar-sync.service

say '9. Verify'
if [ "$apply" -eq 1 ]; then
  for _ in $(seq 1 30); do curl -fsS --max-time 2 http://127.0.0.1:3000/api/health/ready >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS --max-time 2 http://127.0.0.1:3000/api/health/ready && printf '\n' || fail 'Web did not become ready; see: journalctl -u pi-calendar-web -n 50'
  systemctl is-active pi-calendar-web.service pi-calendar-sync.service
else
  say '  + curl http://127.0.0.1:3000/api/health/ready; systemctl is-active pi-calendar-web pi-calendar-sync'
fi
say ''
say 'Next (as the GUI user, no sudo): bash ops/kiosk/install-kiosk.sh'
