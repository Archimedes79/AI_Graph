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

Two capabilities still depend on the target machine, because they shell out to
an interpreter that cannot be embedded: Python code nodes need a `python` on
PATH, JavaScript code nodes need `node`. Everything else (AI calls, file I/O,
GUI widgets, deploy-bundle export) works standalone.
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


def build(name: str, onedir: bool, skip_build: bool) -> int:
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
    # And the licences. `LICENSE` is the editor's own; `LICENSE-runtime` is the
    # one deploy_service copies into every exported bundle -- the licence's own
    # Notices section requires that whoever receives the software receives the
    # terms, so Deploy inside a frozen build has to be able to read it.
    cmd += _add_data(REPO_ROOT / "LICENSE", ".")
    cmd += _add_data(REPO_ROOT / "LICENSE-runtime", ".")

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
    args = parser.parse_args()
    return build(args.name, args.onedir, args.skip_build)


if __name__ == "__main__":
    sys.exit(main())
