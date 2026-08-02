#!/usr/bin/env python3
"""
Cross-platform launcher for the AI-Graph editor (frontend + backend).

  python start.py              # dev mode: uvicorn --reload + vite dev server
  python start.py --mode prod   # prod mode: single uvicorn process serving the
                                 # built frontend (run `npm run build` first)

This is the non-Docker, single-host alternative to docker-compose.yml and to
VS Code's .vscode/tasks.json.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"


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


def run_prod() -> int:
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the AI-Graph editor (frontend + backend).")
    parser.add_argument("--mode", choices=["dev", "prod"], default="dev")
    args = parser.parse_args()

    if args.mode == "prod":
        return run_prod()
    return run_dev()


if __name__ == "__main__":
    sys.exit(main())
