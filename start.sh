#!/bin/sh
# Start the editor: install on first use, build the page when it is missing,
# then serve it on http://127.0.0.1:8000 and open a browser.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (24 or newer), then run this again." >&2
  exit 1
fi

[ -d node_modules ] || { echo "Installing dependencies..."; npm ci; }
[ -f editor/dist/index.html ] || { echo "Building the editor..."; npm run build; }

exec npm start -- "$@"
