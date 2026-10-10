#!/usr/bin/env bash
# Install the kiosk supervisor for the current GUI user (no sudo). Dry run by default; --apply to change files.
#   bash ops/kiosk/install-kiosk.sh            # show the plan
#   bash ops/kiosk/install-kiosk.sh --apply    # install, then log out/in or reboot to start
#   bash ops/kiosk/install-kiosk.sh --uninstall --apply
set -euo pipefail
apply=0; uninstall=0
for a in "$@"; do case "$a" in --apply) apply=1 ;; --uninstall) uninstall=1 ;; *) printf 'Unknown option: %s\n' "$a" >&2; exit 2 ;; esac; done
[ "$(id -u)" -ne 0 ] || { printf 'Run as the GUI login user, not root.\n' >&2; exit 1; }
src="$(cd "$(dirname "$0")" && pwd)/kiosk-supervisor.sh"
bin="$HOME/.local/bin/pi-calendar-kiosk"
autostart="$HOME/.config/labwc/autostart"
line='"$HOME/.local/bin/pi-calendar-kiosk" &'
run() { printf '  + %s\n' "$*"; if [ "$apply" -eq 1 ]; then "$@"; fi; }
printf 'Pi Calendar kiosk — %s\n' "$([ "$apply" -eq 1 ] && echo APPLY || echo 'DRY RUN (add --apply)')"
pgrep -x labwc >/dev/null || printf 'WARNING: labwc is not running for this session; this installer only configures labwc autostart.\n'
if [ -f "$autostart" ]; then run cp -a "$autostart" "$autostart.bak.$(date -u +%Y%m%dT%H%M%SZ)"; fi
if [ "$uninstall" -eq 1 ]; then
  if [ -f "$autostart" ]; then run sed -i.tmp '\#pi-calendar-kiosk#d' "$autostart"; run rm -f "$autostart.tmp"; fi
  run rm -f "$bin"
  printf 'Removed. A running kiosk stops with: touch ~/.config/pi-calendar/maintenance\n'
  exit 0
fi
run mkdir -p "$(dirname "$bin")"
run install -m 0755 "$src" "$bin"
run mkdir -p "$HOME/.config/labwc"
if [ -f "$autostart" ] && grep -qF 'pi-calendar-kiosk' "$autostart"; then
  printf '  = autostart entry already present\n'
else
  printf '  + append to %s: %s\n' "$autostart" "$line"
  if [ "$apply" -eq 1 ]; then printf '%s\n' "$line" >> "$autostart"; fi
fi
if grep -qs swayidle "$autostart"; then printf 'NOTE: screen blanking (swayidle) is enabled in %s; disable it with raspi-config → Display → Screen Blanking for an always-on calendar.\n' "$autostart"; fi
printf 'Start now without re-login: %s &   |   Maintenance: touch ~/.config/pi-calendar/maintenance\n' "$bin"
