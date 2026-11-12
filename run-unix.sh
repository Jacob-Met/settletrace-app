#!/bin/sh
set -eu
SETTLETRACE_LAUNCH_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ is required: https://nodejs.org/" >&2
  exit 1
fi
echo "Starting SettleTrace. Open the local URL reported below after startup."
exec node "$SETTLETRACE_LAUNCH_ROOT/scripts/start-workspace.mjs" "$@"
