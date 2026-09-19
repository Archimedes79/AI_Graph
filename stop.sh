#!/bin/sh
# Stop the editor through the shared launcher, which only stops an AI-Graph
# server: see scripts/editorProcess.mjs.
set -e
cd "$(dirname "$0")"

exec node scripts/stop.mjs "$@"
