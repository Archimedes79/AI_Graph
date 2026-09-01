#!/usr/bin/env python3
"""
Build a checkpoint: verify the tree, then package the editor.

    python checkpoint.py                 # verify everything, then package
    python checkpoint.py --exe           # ...and build a standalone executable
    python checkpoint.py --skip-tests    # just build + package
    python checkpoint.py --verify-only   # run the checks, produce nothing

Every step is something you would otherwise type by hand, in the order that
makes a failure cheapest to read: generated types first (a stale
graph.generated.ts makes the frontend fail in a confusing way), then the two
test suites, then the build, then the package. It stops at the first failure
unless --keep-going, and the summary at the end is the thing to paste when
something is broken.

The packaged zip lands in dist/ (git-ignored). Unzip it on the target machine,
`pip install -r backend/requirements.txt`, then `python start.py --mode prod`.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
ENGINE_DIR = REPO_ROOT / "engine"
IS_WINDOWS = sys.platform == "win32"


def backend_python() -> str:
    """This repo's backend venv if it exists, else whatever python is on PATH."""
    venv = BACKEND_DIR / ".venv" / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")
    if venv.exists():
        return str(venv)
    return shutil.which("python") or shutil.which("python3") or "python"


class Step:
    def __init__(self, name: str, command: list[str], cwd: Path, explain: str = ""):
        self.name, self.command, self.cwd, self.explain = name, command, cwd, explain
        self.status = "skipped"
        self.seconds = 0.0

    def run(self) -> bool:
        print(f"\n=== {self.name} ===")
        print(f"    {' '.join(self.command)}   (in {self.cwd.relative_to(REPO_ROOT) or '.'})")
        started = time.monotonic()
        # shell=True on Windows so `npm`/`npx` resolve through their .cmd shims.
        result = subprocess.run(self.command, cwd=self.cwd, shell=IS_WINDOWS)
        self.seconds = time.monotonic() - started
        self.status = "ok" if result.returncode == 0 else "FAILED"
        if result.returncode != 0 and self.explain:
            print(f"\n    {self.explain}")
        return result.returncode == 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip-tests", action="store_true", help="build and package without running the suites")
    parser.add_argument("--verify-only", action="store_true", help="run the checks but produce no package")
    parser.add_argument("--keep-going", action="store_true", help="run every step even after a failure")
    parser.add_argument("--exe", action="store_true",
                        help="also build a standalone executable, carrying its own Python (needs PyInstaller on this machine)")
    args = parser.parse_args()

    python = backend_python()
    steps: list[Step] = []

    if not args.skip_tests:
        steps += [
            Step("Generated types are current", ["npm", "run", "gen:types:check"], FRONTEND_DIR,
                 "Run `npm run gen:types` and commit graph.generated.ts."),
            # vitest does not type-check, so --verify-only used to pass on code
            # that could not build. This is the same tsc the build runs, without
            # the bundling.
            Step("Frontend types", ["npm", "run", "typecheck"], FRONTEND_DIR),
            Step("Backend tests", [python, "-m", "pytest", "tests", "-q"], BACKEND_DIR),
            # The engine's suite ends in a differential test: the same example
            # graphs through the TypeScript engine and through graph-runner's
            # Python one, with the outputs diffed. It needs both to be present,
            # which is why it runs here rather than in either half.
            Step("Engine types", ["npm", "run", "typecheck"], ENGINE_DIR),
            Step("Engine tests", ["npm", "run", "test"], ENGINE_DIR),
            Step("Frontend tests", ["npm", "run", "test"], FRONTEND_DIR),
        ]

    if not args.verify_only:
        steps += [
            Step("Frontend build", ["npm", "run", "build"], FRONTEND_DIR,
                 "If this is a fresh checkout, run `npm install` in frontend/ first."),
            # --skip-build: the step above already produced frontend/dist.
            Step("Package the editor", [python, "start.py", "--mode", "package", "--skip-build",
                                        "--output", "dist/ai-graph-editor-package.zip"], REPO_ROOT),
        ]
        if args.exe:
            steps.append(
                # --embed-python because that is how the release is built: an exe
                # verified here without one would differ from the one people
                # download, in the capability most likely to be missing on their
                # machine. Build without it directly if you want the smaller file.
                Step("Build standalone executable",
                     [python, "build_editor_exe.py", "--skip-build", "--embed-python"], REPO_ROOT,
                     "Install PyInstaller first:  pip install pyinstaller")
            )

    failed = False
    for step in steps:
        if failed and not args.keep_going:
            break
        if not step.run():
            failed = True

    print("\n" + "=" * 60)
    for step in steps:
        marker = {"ok": "  ok  ", "FAILED": " FAIL ", "skipped": " skip "}[step.status]
        print(f"[{marker}] {step.name}  ({step.seconds:.1f}s)")
    print("=" * 60)

    if failed:
        print("\nCheckpoint NOT clean -- see the first FAIL above.")
        return 1

    if not args.verify_only:
        package = REPO_ROOT / "dist" / "ai-graph-editor-package.zip"
        if package.exists():
            print(f"\nCheckpoint ready: {package} ({package.stat().st_size / 1024:.0f} KB)")
            print("On the target machine: unzip, `pip install -r backend/requirements.txt`,")
            print("then `python start.py --mode prod` -> http://localhost:8000")
        exe = next(iter(REPO_ROOT.glob("dist/ai-graph.exe")), None) or next(iter(REPO_ROOT.glob("dist/ai-graph")), None)
        if args.exe and exe and exe.is_file():
            print(f"\nStandalone executable: {exe} ({exe.stat().st_size / 1024 / 1024:.0f} MB)")
            print("Needs no Python on the target machine; run it -> http://127.0.0.1:8000")
    else:
        print("\nCheckpoint verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
