#!/usr/bin/env python3
"""
Cross-platform launcher for the AI-Graph editor (frontend + backend).

  python start.py               # dev mode: uvicorn --reload + vite dev server
  python start.py --mode prod   # prod mode: single uvicorn process serving the
                                 # built frontend (run `npm run build` first)
  python start.py --mode package [--output PATH] [--skip-build]
                                 # build a distributable zip (backend app,
                                 # requirements.txt, built frontend, start.py,
                                 # README.md) for deploying the editor itself
                                 # to another server

This is the non-Docker, single-host alternative to docker-compose.yml and to
VS Code's .vscode/tasks.json.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import threading
import webbrowser
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"

_PACKAGE_EXCLUDE_DIRS = {"__pycache__", ".venv", "node_modules", "tests"}


def _venv_python() -> str:
    """Resolve this repo's backend/.venv python, falling back to PATH."""
    if sys.platform == "win32":
        venv_python = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        venv_python = BACKEND_DIR / ".venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    return shutil.which("python") or shutil.which("python3") or "python"


def _stream_output(process: subprocess.Popen, prefix: str) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        print(f"[{prefix}] {line}", end="")


def run_dev() -> int:
    python = _venv_python()
    backend_cmd = [python, "-m", "uvicorn", "app.main:app", "--reload", "--reload-dir", "app", "--port", "8000"]
    frontend_cmd = ["npm", "run", "dev"]

    print(f"[start] backend:  {' '.join(backend_cmd)} (cwd={BACKEND_DIR})")
    print(f"[start] frontend: {' '.join(frontend_cmd)} (cwd={FRONTEND_DIR})")
    # Dev mode printed the two commands and never the address, unlike --mode
    # prod -- so the one thing you actually need was the one thing missing.
    print("[start] AI-Graph editor -> http://127.0.0.1:3000   (Ctrl+C to stop)")

    backend = subprocess.Popen(
        backend_cmd, cwd=BACKEND_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    frontend = subprocess.Popen(
        frontend_cmd, cwd=FRONTEND_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        shell=(sys.platform == "win32"),
    )

    threads = [
        threading.Thread(target=_stream_output, args=(backend, "backend"), daemon=True),
        threading.Thread(target=_stream_output, args=(frontend, "frontend"), daemon=True),
    ]
    for t in threads:
        t.start()

    try:
        while backend.poll() is None and frontend.poll() is None:
            for t in threads:
                t.join(timeout=0.5)
    except KeyboardInterrupt:
        print("\n[start] Stopping backend and frontend...")
    finally:
        for process in (backend, frontend):
            if process.poll() is None:
                process.terminate()
        for process in (backend, frontend):
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()

    return backend.returncode or frontend.returncode or 0


def run_prod_frozen() -> int:
    """
    Packaged editor (see build_editor_exe.py): serve the embedded API and UI
    from THIS process. A frozen build cannot spawn `python -m uvicorn` the way
    the checkout does -- sys.executable is the editor itself -- so it runs the
    ASGI app in-process, and opens a browser because the exe is double-clicked
    at least as often as it is launched from a shell.
    """
    import uvicorn
    from app.main import app

    port = int(os.getenv("AI_GRAPH_PORT", "8000"))
    url = f"http://127.0.0.1:{port}"
    print(f"[start] AI-Graph editor -> {url}   (Ctrl+C to stop)")
    # AI_GRAPH_NO_BROWSER: for CI and for running the tool on a headless box,
    # where there is no browser to open and the attempt is just noise.
    if not os.getenv("AI_GRAPH_NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
    return 0


def run_prod() -> int:
    if getattr(sys, "frozen", False):
        return run_prod_frozen()

    dist_dir = FRONTEND_DIR / "dist"
    if not dist_dir.is_dir():
        print("[start] frontend/dist not found.")
        print("[start] Build it first:  cd frontend && npm run build")
        return 1

    python = _venv_python()
    backend_cmd = [python, "-m", "uvicorn", "app.main:app", "--port", "8000"]
    print(f"[start] backend: {' '.join(backend_cmd)} (cwd={BACKEND_DIR})")
    print("[start] Serving built frontend from frontend/dist on the same port.")

    process = subprocess.Popen(backend_cmd, cwd=BACKEND_DIR)
    try:
        return process.wait()
    except KeyboardInterrupt:
        print("\n[start] Stopping backend...")
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
        return 0


def _add_tree(zf: zipfile.ZipFile, src: Path, arc_prefix: str) -> None:
    for path in src.rglob("*"):
        if path.is_dir() or any(part in _PACKAGE_EXCLUDE_DIRS for part in path.relative_to(src).parts):
            continue
        zf.write(path, f"{arc_prefix}/{path.relative_to(src).as_posix()}")


def build_package(output: Path | None = None, skip_build: bool = False) -> Path:
    """Zip the backend app, requirements.txt, built frontend, start.py and README
    into a distributable package for deploying the editor to another server."""
    dist_dir = FRONTEND_DIR / "dist"
    if skip_build:
        if not dist_dir.is_dir():
            raise SystemExit("[package] frontend/dist not found; run without --skip-build first.")
    else:
        print("[package] Building frontend (npm run build)...")
        result = subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR, shell=(sys.platform == "win32"))
        if result.returncode != 0:
            raise SystemExit("[package] Frontend build failed.")

    output = output or (REPO_ROOT / "ai-graph-editor-package.zip")
    output.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        _add_tree(zf, BACKEND_DIR / "app", "backend/app")
        zf.write(BACKEND_DIR / "requirements.txt", "backend/requirements.txt")
        _add_tree(zf, dist_dir, "frontend/dist")
        zf.write(REPO_ROOT / "start.py", "start.py")
        zf.write(REPO_ROOT / "README.md", "README.md")

    print(f"[package] Wrote {output} ({output.stat().st_size / 1024:.0f} KB)")
    print("[package] On the target server: unzip, `pip install -r backend/requirements.txt`")
    print("[package]  (ideally inside a venv), then run `python start.py --mode prod`.")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the AI-Graph editor (frontend + backend).")
    # A packaged build has no npm/vite to run, and serving the embedded UI is
    # the only thing it can do -- so that is what a double-click gets.
    parser.add_argument(
        "--mode", choices=["dev", "prod", "package"],
        default="prod" if getattr(sys, "frozen", False) else "dev",
    )
    parser.add_argument("--output", type=Path, default=None, help="package mode: output zip path")
    parser.add_argument(
        "--skip-build", action="store_true",
        help="package mode: reuse the existing frontend/dist instead of rebuilding it",
    )
    args = parser.parse_args()

    if args.mode == "prod":
        return run_prod()
    if args.mode == "package":
        build_package(args.output, args.skip_build)
        return 0
    return run_dev()


if __name__ == "__main__":
    sys.exit(main())
