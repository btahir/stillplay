#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shared_wrapper="$project_root/../research/heavy.sh"
if [[ -x "$shared_wrapper" ]]; then
  exec "$shared_wrapper" "$@"
fi
# Standalone checkouts retain the same two machine-wide slots.
if [[ $# -eq 0 ]]; then
  printf 'Usage: heavy.sh command [args...]\n' >&2
  exit 2
fi
lock_root="${TMPDIR:-/tmp}/stillplay-heavy-jobs"
mkdir -p "$lock_root"
while true; do
  for slot in 1 2; do
    exec {lock_fd}>"$lock_root/$slot.lock"
    if flock -n "$lock_fd"; then
      "$@"
      exit $?
    fi
    exec {lock_fd}>&-
  done
  sleep 0.2
done
