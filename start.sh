#!/bin/sh
# Start the editor, finding an interpreter rather than assuming one.
#
# `python start.py` is what the documentation said, and it is wrong on more
# machines than it is right: on Windows `python` is a Microsoft Store stub that
# prints an advertisement, and on macOS it is often absent while `python3` is
# not. A project with its own virtual environment and a stub on PATH is the
# normal case, so the launcher looks for a real interpreter instead of leaving
# you to guess which name works.
set -e
here="$(cd "$(dirname "$0")" && pwd)"

for candidate in \
  "$here/.venv/bin/python" "$here/.venv/Scripts/python.exe" \
  "$here/backend/.venv/bin/python" "$here/backend/.venv/Scripts/python.exe" \
  python3 python
do
  if "$candidate" -c 'import sys' >/dev/null 2>&1; then
    echo "Using $candidate"
    exec "$candidate" "$here/start.py" "$@"
  fi
done

cat >&2 <<'MESSAGE'

No Python interpreter found.

The editor's backend needs one. Either install Python, or create the
project's environment:

    python3 -m venv .venv
    .venv/bin/pip install -r backend/requirements.txt

A graph on its own needs no Python at all:  node engine/src/main.ts graph.json
MESSAGE
exit 1
