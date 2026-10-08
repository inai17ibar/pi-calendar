#!/usr/bin/env bash
# Reference implementation; requires an implemented app and a real Pi GUI session.
# Does not install/modify desktop settings. Do not run as root.
set -eu
if [ "${1:-}" = '--help' ]; then
  printf 'Run in the GUI user session. Maintenance file: ~/.config/pi-calendar/maintenance\n'
  exit 0
fi
if [ "$(id -u)" -eq 0 ]; then printf 'Refusing to run Chromium as root.\n' >&2; exit 1; fi
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
  printf 'Run in a graphical session, not a plain SSH shell.\n' >&2; exit 1
fi
for c in curl flock; do command -v "$c" >/dev/null 2>&1 || { printf '%s missing\n' "$c" >&2; exit 1; }; done
browser=''
for c in chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then browser=$(command -v "$c"); break; fi
done
[ -n "$browser" ] || { printf 'Chromium not found.\n' >&2; exit 1; }
url='http://127.0.0.1:3000'
profile="$HOME/.config/pi-calendar/chromium"
maintenance="$HOME/.config/pi-calendar/maintenance"
lockdir="${XDG_RUNTIME_DIR:-$HOME/.cache/pi-calendar}"
mkdir -p "$profile" "$lockdir"
chmod 700 "$profile"
exec 9>"$lockdir/pi-calendar-kiosk.lock"
flock -n 9 || exit 0
child=''
cleanup() {
  if [ -n "$child" ] && kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM
args=(--kiosk --no-first-run --no-default-browser-check "--user-data-dir=$profile")
if [ -n "${WAYLAND_DISPLAY:-}" ]; then args+=(--ozone-platform=wayland); fi
until [ -e "$maintenance" ]; do
  until curl --fail --silent --show-error --max-time 3 "$url/api/health/ready" >/dev/null 2>&1; do
    [ ! -e "$maintenance" ] || exit 0
    sleep 2
  done
  [ ! -e "$maintenance" ] || exit 0
  "$browser" "${args[@]}" "$url" &
  child=$!
  while kill -0 "$child" 2>/dev/null; do
    [ ! -e "$maintenance" ] || exit 0
    sleep 2
  done
  wait "$child" || true
  child=''
  sleep 2
done
