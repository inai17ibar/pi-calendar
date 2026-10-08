#!/usr/bin/env bash
# Open a loopback-only SSH tunnel; never weakens SSH host-key checking.
set -eu
usage() { printf 'Usage: bash %s HOST_ALIAS [LOCAL_PORT=3300] [PI_PORT=3000]\n' "$0"; }
if [ "${1:-}" = '--help' ] || [ "${1:-}" = '-h' ]; then usage; exit 0; fi
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then usage >&2; exit 2; fi
host=$1
local_port=${2:-3300}
remote_port=${3:-3000}
if ! [[ "$host" =~ ^[A-Za-z0-9_][A-Za-z0-9_.@-]*$ ]]; then
  printf 'Use an SSH alias or a simple [user@]hostname. Configure IPv6 via an SSH alias.\n' >&2; exit 2
fi
for p in "$local_port" "$remote_port"; do
  if ! [[ "$p" =~ ^[1-9][0-9]{0,4}$ ]] || [ "$p" -gt 65535 ]; then
    printf 'Ports must be integers in 1..65535 (no leading zeros).\n' >&2; exit 2
  fi
done
command -v ssh >/dev/null 2>&1 || { printf 'ssh is required.\n' >&2; exit 1; }
printf 'Open http://127.0.0.1:%s in your browser. Ctrl-C closes this tunnel.\n' "$local_port"
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${local_port}:127.0.0.1:${remote_port}" -- "$host"
