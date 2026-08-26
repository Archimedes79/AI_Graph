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
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

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


def build(name: str, onedir: bool, windowed: bool) -> int:
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

    cmd.append(str(entry))

    print("[build_exe]", " ".join(cmd))
    result = subprocess.run(cmd, cwd=HERE)
    if result.returncode != 0:
        return result.returncode

    produced = HERE / "dist" / (name if not onedir else f"{name}/")
    print()
    print(f"[build_exe] Done -> {produced}")
    print("[build_exe] Ship that single file; it needs no Python on the target machine.")
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
    args = parser.parse_args()
    return build(args.name, args.onedir, args.windowed)


if __name__ == "__main__":
    sys.exit(main())
