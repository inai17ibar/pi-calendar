#!/usr/bin/env bash
# Read-only diagnostics. No sudo, package install, reboot, or credential reads.
set -eu
printf '%s\n' 'Pi Calendar — read-only environment report'
printf 'Platform: '; uname -s
printf 'Architecture: '; uname -m
if [ -r /etc/os-release ]; then
  grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release || true
fi
printf 'Current shell session (not necessarily the GUI): %s\n' "${XDG_SESSION_TYPE:-unknown}"
printf 'Current desktop hint: %s\n' "${XDG_CURRENT_DESKTOP:-unknown}"
printf '\nTool availability:\n'
for tool in node npm chromium chromium-browser systemctl loginctl curl flock git tailscale; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf '  %s: %s\n' "$tool" "$(command -v "$tool")"
  else
    printf '  %s: missing\n' "$tool"
  fi
done
if command -v node >/dev/null 2>&1; then
  node -p 'JSON.stringify({node:process.version,platform:process.platform,arch:process.arch})'
fi
if command -v npm >/dev/null 2>&1; then printf 'npm: '; npm --version; fi
if command -v free >/dev/null 2>&1; then printf '\nMemory:\n'; free -h; fi
printf '\nDisk capacity (paths only; review before sharing):\n'
df -h . / 2>/dev/null || true
if command -v systemctl >/dev/null 2>&1; then
  printf '\nApplication services (not installed is normal at this stage):\n'
  systemctl is-active pi-calendar-web.service pi-calendar-sync.service 2>/dev/null || true
fi
printf '\nNo configuration was changed. GUI session, actual touch, boot, and power recovery still need verification.\n'
