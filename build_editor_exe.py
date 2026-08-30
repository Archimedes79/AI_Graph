#!/usr/bin/env python3
"""
Build the AI-Graph EDITOR into one self-contained executable.

    python build_editor_exe.py                   # -> dist/ai-graph[.exe]
    python build_editor_exe.py --name my-editor  # custom executable name
    python build_editor_exe.py --onedir          # a folder instead of a single file
    python build_editor_exe.py --skip-build      # reuse an existing frontend/dist

The result needs no Python, no Node and no pip on the target machine: the
backend, the built frontend, and the sources the Deploy feature vendors are all
embedded. Double-clicking it serves the editor on http://127.0.0.1:8000 and
opens a browser (`start.py --mode prod`, which detects the frozen build).

This is the executable form of `start.py --mode package`, which produces a zip
that still expects Python and `pip install` on the target.

PyInstaller is needed on the BUILD machine only:

    pip install pyinstaller

Cross-compiling is not supported -- build the Windows .exe on Windows, the
Linux binary on Linux, the macOS binary on macOS.

Code nodes shell out to an interpreter, so they are the one thing that depends
on the target machine. `--embed-python` closes that for Python: it ships
python.org's embeddable interpreter inside the executable, and code nodes that
import only the standard library then run on a machine with no Python at all.
Packages (pandas and friends) still need a real Python installed, because the
embeddable package has no pip -- and JavaScript code nodes still need `node`.
Everything else (AI calls, file I/O, GUI widgets, deploy-bundle export) is
standalone either way.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
RUNNER_DIR = REPO_ROOT / "graph-runner"

# The same module a deploy bundle's own build_exe.py uses, from the same file:
# an editor executable and a tool built out of one ship their interpreter the
# same way, or the promise differs depending on which button you pressed.
sys.path.insert(0, str(RUNNER_DIR))
import python_embed  # noqa: E402

# Entry point: start.py serves the embedded API+UI in-process when frozen.
_ENTRY = REPO_ROOT / "start.py"


def _add_data(src: Path, dest: str) -> list[str]:
    """
    One --add-data argument. PyInstaller separates source from destination with
    ';' on Windows and ':' everywhere else -- os.pathsep is exactly that.
    """
    return ["--add-data", f"{src}{os.pathsep}{dest}"]


def _ensure_frontend(skip_build: bool) -> bool:
    if skip_build:
        if not FRONTEND_DIST.is_dir():
            print("[build] frontend/dist not found; run without --skip-build first.", file=sys.stderr)
            return False
        return True

    print("[build] Building frontend (npm run build)...")
    result = subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR, shell=(sys.platform == "win32"))
    if result.returncode != 0:
        print("[build] Frontend build failed. In a fresh checkout run `npm install` in frontend/ first.", file=sys.stderr)
        return False
    return True


def build(name: str, onedir: bool, skip_build: bool, embed_python: str) -> int:
    if importlib.util.find_spec("PyInstaller") is None:
        print("PyInstaller is not installed. Install it first:", file=sys.stderr)
        print("    pip install pyinstaller", file=sys.stderr)
        return 1

    if not _ensure_frontend(skip_build):
        return 1

    # Build outside the repo, then copy the finished artifact in. PyInstaller
    # writes and immediately reopens the executable to stamp its manifest, which
    # fails when a file-syncing client (Dropbox/OneDrive) or an AV scanner grabs
    # the new file first -- and this repo does live in a synced folder.
    work_root = Path(tempfile.mkdtemp(prefix="ai-graph-exe-"))

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name", name,
        "--onedir" if onedir else "--onefile",
        "--distpath", str(work_root / "dist"),
        "--workpath", str(work_root / "build"),
        "--specpath", str(work_root),
        # Make `app.*` importable from backend/ the way uvicorn does in a checkout.
        "--paths", str(BACKEND_DIR),
        # routers/ and elements/ are reached through registries and FastAPI
        # decorators, which static analysis alone does not always follow.
        "--collect-submodules", "app",
        # uvicorn resolves its protocol/loop implementations by import string
        # at runtime, so static analysis misses them.
        "--collect-all", "uvicorn",
    ]

    # The built editor UI, served by app/main.py's StaticFiles mount.
    cmd += _add_data(FRONTEND_DIST, "frontend/dist")
    # The app package AS SOURCE, not just as importable modules: deploy_service
    # vendors these .py files verbatim into every bundle a user exports, so the
    # exe has to carry readable copies, not only compiled ones.
    cmd += _add_data(BACKEND_DIR / "app", "app")
    # Same reason: a bundle's main.py/serve.py/build_exe.py are these files.
    cmd += _add_data(REPO_ROOT / "graph-runner", "graph-runner")
    # And the licence, which deploy_service copies into every exported bundle:
    # its own Notices section requires that whoever receives the software
    # receives the terms, so Deploy inside a frozen build must be able to read it.
    cmd += _add_data(REPO_ROOT / "LICENSE", ".")

    # The interpreter code nodes run in, if this build is to carry one. It goes
    # into the scratch tree, not the repo: it is a build input, not a source file.
    if embed_python:
        try:
            packed = python_embed.provision(work_root, embed_python)
        except RuntimeError as exc:
            shutil.rmtree(work_root, ignore_errors=True)
            print(f"[build] {exc}", file=sys.stderr)
            return 1
        cmd += _add_data(packed, python_embed.DIR_NAME)

    cmd.append(str(_ENTRY))

    print("[build]", " ".join(cmd))
    try:
        result = subprocess.run(cmd, cwd=REPO_ROOT)
        if result.returncode != 0:
            return result.returncode
        produced = _collect_artifact(work_root, name, onedir)
    finally:
        shutil.rmtree(work_root, ignore_errors=True)

    print()
    print(f"[build] Done -> {produced}")
    print("[build] Ship it; it needs no Python, Node or pip on the target machine.")
    if embed_python:
        print("[build] It carries its own Python, so stdlib code nodes run there too.")
    else:
        print("[build] Python code nodes will need a python on the target's PATH "
              "(--embed-python ships one).")
    print("[build] Run it (or double-click) -> http://127.0.0.1:8000")
    return 0


def _collect_artifact(work_root: Path, name: str, onedir: bool) -> Path:
    """Move the built executable (or --onedir folder) from the scratch build into dist/."""
    exe_name = f"{name}.exe" if sys.platform == "win32" else name
    source = work_root / "dist" / (name if onedir else exe_name)
    dest_root = REPO_ROOT / "dist"
    dest_root.mkdir(parents=True, exist_ok=True)
    dest = dest_root / source.name

    if dest.is_dir():
        shutil.rmtree(dest)
    elif dest.exists():
        dest.unlink()

    shutil.move(str(source), str(dest))
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--name", default="ai-graph", help="executable name (default: ai-graph)")
    parser.add_argument(
        "--onedir", action="store_true",
        help="emit a folder instead of a single file (starts faster, ships as many files)",
    )
    parser.add_argument(
        "--skip-build", action="store_true",
        help="reuse the existing frontend/dist instead of rebuilding it",
    )
    parser.add_argument(
        "--embed-python", nargs="?", const="auto", default="", metavar="PATH",
        help="ship a Python interpreter inside the executable, so stdlib code nodes "
             "run on a machine with no Python (adds ~23 MB). Downloads the embeddable "
             "package matching this interpreter, or unpacks the zip/directory given.",
    )
    args = parser.parse_args()
    return build(args.name, args.onedir, args.skip_build, args.embed_python)


if __name__ == "__main__":
    sys.exit(main())
