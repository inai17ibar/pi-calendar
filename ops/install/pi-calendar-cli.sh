#!/usr/bin/env bash
# Production CLI wrapper: sudo pi-calendar <auth google|calendars list|calendars select ...|status>
# Runs the current release's CLI as the service user with the production runtime.env.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { printf 'Use: sudo pi-calendar %s\n' "$*" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. /etc/pi-calendar/runtime.env
set +a
node=$(sed -n 's/.*"nodeVersion":"\(v[0-9.]*\)".*/\1/p' /opt/pi-calendar/current/release.json)
cd /opt/pi-calendar/current
if [ "${1:-}" = auth ]; then
  # Re-auth while the worker runs could race on a rotated refresh token; pause it for the duration.
  systemctl stop pi-calendar-sync.service
  trap 'systemctl start pi-calendar-sync.service' EXIT
fi
runuser -u calendar-app -- "/opt/pi-calendar/node-$node/bin/node" dist/cli.mjs "$@"
