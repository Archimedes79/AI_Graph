#!/usr/bin/env python3
"""
Build this deploy bundle into ONE self-contained executable.

    python build_exe.py                  # -> dist/<name>[.exe]
    python build_exe.py --name my-tool   # custom executable name
    python build_exe.py --onedir         # a folder instead of a single file

The result needs no Python, no pip and no AI-Graph installation on the target
machine: graph.json (and this bundle's GUI runtime files, if it has any) are
embedded, so the executable IS the tool.

PyInstaller is needed on the BUILD machine only:

    pip install pyinstaller

Cross-compiling is not supported -- build the Windows .exe on Windows, the
Linux binary on Linux, the macOS binary on macOS.

A `graph.json` placed next to the finished executable takes precedence over
the embedded one (see `_default_graph_path` in main.py), so the same binary
can be re-pointed at an edited graph without rebuilding it.

If this tool has Python code nodes, add `--embed-python`: it ships an
interpreter inside the executable so those nodes run on a machine with no
Python installed. Nodes that declare packages (pandas and the like) still need
a real Python on the target, because the embeddable interpreter has no pip.
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

import python_embed

HERE = Path(__file__).resolve().parent

# Entry point: a bundle with a GUI runtime starts the local server (serve.py),
# a headless one runs the CLI (main.py). Both load the same graph.json through
# the same vendored engine.
_GUI_ENTRY = HERE / "serve.py"
_CLI_ENTRY = HERE / "main.py"


def _add_data(src: Path, dest: str) -> list[str]:
    """
    One --add-data argument. PyInstaller separates source from destination with
    ';' on Windows and ':' everywhere else -- os.pathsep is exactly that.
    """
    return ["--add-data", f"{src}{os.pathsep}{dest}"]


def build(name: str, onedir: bool, windowed: bool, embed_python: str) -> int:
    if importlib.util.find_spec("PyInstaller") is None:
        print("PyInstaller is not installed. Install it first:", file=sys.stderr)
        print("    pip install pyinstaller", file=sys.stderr)
        return 1

    entry = _GUI_ENTRY if _GUI_ENTRY.is_file() else _CLI_ENTRY
    if not entry.is_file():
        print(f"No entry point found (looked for {_GUI_ENTRY.name} and {_CLI_ENTRY.name}).", file=sys.stderr)
        return 1

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--name", name,
        "--onedir" if onedir else "--onefile",
        # The vendored engine imports every element eagerly through
        # app/elements/registry.py, so PyInstaller's static analysis finds them
        # all -- this only guards against an element added later that is
        # reached dynamically.
        "--collect-submodules", "app",
    ]

    if windowed:
        # No console window. Only meaningful for a GUI-runtime bundle, whose
        # interface is the browser page it opens; a CLI bundle needs stdin.
        cmd.append("--windowed")

    cmd += _add_data(HERE / "graph.json", ".")

    static_dir = HERE / "static"
    if static_dir.is_dir():
        cmd += _add_data(static_dir, "static")
        # uvicorn resolves its protocol/loop implementations by import string
        # at runtime, so static analysis alone misses them.
        cmd += ["--collect-all", "uvicorn"]

    # The interpreter code nodes run in, if this tool is to carry one. Staged in
    # a scratch directory so the bundle folder itself stays exactly as shipped.
    scratch = tempfile.mkdtemp(prefix="ai-graph-embed-") if embed_python else ""
    if embed_python:
        try:
            packed = python_embed.provision(Path(scratch), embed_python)
        except RuntimeError as exc:
            shutil.rmtree(scratch, ignore_errors=True)
            print(f"[build_exe] {exc}", file=sys.stderr)
            return 1
        cmd += _add_data(packed, python_embed.DIR_NAME)

    cmd.append(str(entry))

    print("[build_exe]", " ".join(cmd))
    try:
        result = subprocess.run(cmd, cwd=HERE)
    finally:
        if scratch:
            shutil.rmtree(scratch, ignore_errors=True)
    if result.returncode != 0:
        return result.returncode

    exe_name = f"{name}.exe" if sys.platform == "win32" else name
    produced = HERE / "dist" / (name if onedir else exe_name)
    print()
    print(f"[build_exe] Done -> {produced}")
    print("[build_exe] Ship that single file; it needs no Python on the target machine.")
    if embed_python:
        print("[build_exe] It carries its own Python, so stdlib code nodes run there too.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--name", default=HERE.name.replace(" ", "_") or "ai-graph-tool",
        help="executable name (default: this bundle folder's name)",
    )
    parser.add_argument(
        "--onedir", action="store_true",
        help="emit a folder instead of a single file (starts faster, ships as many files)",
    )
    parser.add_argument(
        "--windowed", action="store_true",
        help="GUI bundles only: build without a console window",
    )
    parser.add_argument(
        "--embed-python", nargs="?", const="auto", default="", metavar="PATH",
        help="ship a Python interpreter inside the executable, so this tool's code "
             "nodes run on a machine with no Python (adds ~23 MB). Downloads the "
             "embeddable package, or unpacks the zip/directory given.",
    )
    args = parser.parse_args()
    return build(args.name, args.onedir, args.windowed, args.embed_python)


if __name__ == "__main__":
    sys.exit(main())
