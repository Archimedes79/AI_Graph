#!/bin/sh
# Start the editor through the shared launcher: install on first use, rebuild
# stale sources, restart an existing editor, then open http://127.0.0.1:8000.
set -e
cd "$(dirname "$0")"

exec node scripts/start.mjs "$@"
