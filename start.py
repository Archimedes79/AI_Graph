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
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import textwrap
import threading
import urllib.error
import urllib.request
import webbrowser
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"

_PACKAGE_EXCLUDE_DIRS = {"__pycache__", ".venv", "node_modules", "tests"}

BACKEND_PORT = 8000
FRONTEND_PORT = 3000
FRONTEND_FALLBACK_PORT = 3002


def _port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((host, port)) == 0


def _own_backend_already_running(port: int = BACKEND_PORT) -> bool:
    """Distinguish a leftover `start.py` backend from anything else holding
    the port, via the /health route's fixed service name."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.5) as resp:
            body = json.loads(resp.read())
    except (urllib.error.URLError, OSError, ValueError):
        return False
    return body.get("service") == "ai-graph-backend"


def _venv_python() -> str:
    """Resolve this repo's backend/.venv python, falling back to PATH."""
    if sys.platform == "win32":
        venv_python = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        venv_python = BACKEND_DIR / ".venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    return shutil.which("python") or shutil.which("python3") or "python"


def _stream_output(process: subprocess.Popen, prefix: str, on_line=None) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        print(f"[{prefix}] {line}", end="")
        if on_line is not None:
            on_line(line)


_VITE_URL_RE = re.compile(r"Local:\s+(http://\S+)")
# Vite colors its banner (bold "Local", cyan URL, ...) even when piped on
# Windows, so the raw line has escape codes sitting inside "Local:" and
# inside the port digits -- invisible once a terminal renders them, but
# enough to break a regex match against the literal text.
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def run_dev() -> int:
    if _own_backend_already_running():
        # A previous `start.py` is still up: starting a second backend would
        # just fail to bind :8000, and a second frontend would be a stray
        # duplicate tab of the same editor -- so don't launch anything new.
        frontend_port = FRONTEND_FALLBACK_PORT if _port_in_use(FRONTEND_PORT) else FRONTEND_PORT
        print(f"[start] AI-Graph is already running -> http://127.0.0.1:{frontend_port}   (backend on :{BACKEND_PORT})")
        return 0

    python = _venv_python()
    # Run from the repository root, with the backend only on the import path:
    # a relative path typed into Save or a file picker resolves against the
    # server's working directory, and resolving it inside `backend/` is how
    # graphs came to be saved next to the source code.
    backend_cmd = [
        python, "-m", "uvicorn", "app.main:app",
        "--app-dir", str(BACKEND_DIR),
        "--reload", "--reload-dir", str(BACKEND_DIR / "app"),
        "--port", str(BACKEND_PORT),
    ]
    frontend_cmd = ["npm", "run", "dev"]
    if _port_in_use(FRONTEND_PORT):
        # Held by something that isn't our own dev server (checked above): go
        # straight to the one fixed fallback instead of Vite's default cascading
        # probe (3001, 3002, ...), which is noisy and lands on a different port
        # every time depending on whatever else is running on the machine.
        frontend_cmd += ["--", "--port", str(FRONTEND_FALLBACK_PORT), "--strictPort"]

    print(f"[start] backend:  {' '.join(backend_cmd)} (cwd={REPO_ROOT})")
    print(f"[start] frontend: {' '.join(frontend_cmd)} (cwd={FRONTEND_DIR})")

    backend = subprocess.Popen(
        backend_cmd, cwd=REPO_ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    frontend = subprocess.Popen(
        frontend_cmd, cwd=FRONTEND_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        shell=(sys.platform == "win32"),
    )

    def _announce_frontend_url(line: str) -> None:
        # Vite's dev-server port is a guess (3000) until it actually binds one --
        # port 3000 in use silently shifts it to 3001/3002/..., so printing a
        # fixed address up front is wrong exactly when a stale process is still
        # holding the port. Read the real URL back out of Vite's own banner.
        match = _VITE_URL_RE.search(_ANSI_RE.sub("", line))
        if match:
            print(f"[start] AI-Graph editor -> {match.group(1)}   (Ctrl+C to stop)")

    threads = [
        threading.Thread(target=_stream_output, args=(backend, "backend"), daemon=True),
        threading.Thread(target=_stream_output, args=(frontend, "frontend", _announce_frontend_url), daemon=True),
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
    # Same reason as dev mode: the working directory is the project, so a
    # relative path a person types lands where they are working.
    backend_cmd = [python, "-m", "uvicorn", "app.main:app", "--app-dir", str(BACKEND_DIR), "--port", "8000"]
    print(f"[start] backend: {' '.join(backend_cmd)} (cwd={REPO_ROOT})")
    print("[start] Serving built frontend from frontend/dist on the same port.")

    process = subprocess.Popen(backend_cmd, cwd=REPO_ROOT)
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
    """Zip the backend app, requirements.txt, built frontend, start.py, README and docs
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
        _add_tree(zf, REPO_ROOT / "docs", "docs")
        # The instructions have to travel WITH the zip. They used to be printed
        # by this function -- to the person building the package, who already
        # knows them -- while whoever unzipped it found only the project README,
        # which explains what AI-Graph is and not how to start this folder.
        zf.writestr("START-HERE.md", _package_instructions())

    print(f"[package] Wrote {output} ({output.stat().st_size / 1024:.0f} KB)")
    print("[package] Unzip it and follow START-HERE.md (it ships inside the zip).")
    return output


def _package_instructions() -> str:
    """The four commands that turn this zip into a running editor.

    A source package, deliberately: it runs anywhere Python does. If you want
    something to double-click with no Python at all, that is the executable --
    `build_editor_exe.py` here, or the "Build executable" workflow on GitHub.
    """
    return textwrap.dedent(
        """\
        # Start here

        This is the AI-Graph editor as a source package: the backend, the built
        user interface, and the launcher. You need Python 3.10 or newer. There is
        no Node and no build step -- the interface is already built.

        ## Windows

            python -m venv .venv
            .venv\\Scripts\\activate
            pip install -r backend/requirements.txt
            python start.py --mode prod

        ## macOS / Linux

            python3 -m venv .venv
            source .venv/bin/activate
            pip install -r backend/requirements.txt
            python start.py --mode prod

        Then open <http://127.0.0.1:8000>. `Ctrl+C` stops it.

        `AI_GRAPH_PORT=9000` runs it on another port.

        ## Not what you wanted?

        - **One file to double-click, no Python** -> build the executable instead:
          `python build_editor_exe.py` in a full checkout, or download the artifact
          from the repository's "Build executable" workflow.
        - **Run one graph, without the editor** -> use a deploy bundle: open the
          graph in the editor and press "Deploy".
        - **Docker** -> `docker compose up --build` in a full checkout.

        The four documents in `docs/` cover installation, the graph DSL, AI
        providers and deployment in more depth.
        """
    )


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
