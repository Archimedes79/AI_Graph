"""
Talking to the TypeScript engine.

Running a graph is the engine's job now, and the engine is a Node process the
editor starts beside itself. This is the whole of the editor's side of that: a
child process with a port, and four forwarded requests.

**Why a process and not a port of the code.** There is one engine, in
TypeScript, and a bundle a recipient runs is a verbatim copy of it. If the
editor ran a *second* implementation, the thing you press Run on would not be
the thing you hand over -- which was the whole argument for vendoring the
engine into bundles rather than generating code, one language earlier.

The child is started lazily on the first run rather than at import, so a
backend that is only serving the editor's static files or answering a
generation request never spawns Node at all.
"""

from __future__ import annotations

import atexit
import logging
import shutil
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

# Where the engine lives, from the repo and from a frozen build alike.
_REPO_ROOT = Path(__file__).resolve().parents[3]
ENGINE_MAIN = _REPO_ROOT / "engine" / "src" / "main.ts"

_START_TIMEOUT = 30.0
_process: Optional[subprocess.Popen] = None
_base_url: str = ""


class EngineUnavailable(RuntimeError):
    """The engine could not be started, with a sentence saying what to do."""


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def node_command() -> str:
    found = shutil.which("node")
    if not found:
        raise EngineUnavailable(
            "Node is not installed, and the engine that runs graphs needs it. "
            "Install Node 22 or newer from nodejs.org."
        )
    return found


def start() -> str:
    """Start the engine if it is not running, and return its base URL."""
    global _process, _base_url

    if _process is not None and _process.poll() is None:
        return _base_url

    if not ENGINE_MAIN.exists():
        raise EngineUnavailable(f"The engine is missing: expected {ENGINE_MAIN}")

    port = _free_port()
    command = [node_command(), str(ENGINE_MAIN), "graph.json", "--serve", "--port", str(port)]
    logger.info("Starting the engine: %s", " ".join(command))

    _process = subprocess.Popen(
        command,
        cwd=str(_REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    _base_url = f"http://127.0.0.1:{port}"

    # Wait for it to answer rather than for a fixed delay: a first run that
    # fails because the port was not open yet is the kind of flake nobody ever
    # reproduces.
    deadline = time.monotonic() + _START_TIMEOUT
    while time.monotonic() < deadline:
        if _process.poll() is not None:
            output = _process.stdout.read() if _process.stdout else ""
            raise EngineUnavailable(f"The engine exited at startup:\n{output[-800:]}")
        try:
            httpx.get(f"{_base_url}/api/runtime/graph", timeout=0.5)
            return _base_url
        except httpx.HTTPError:
            time.sleep(0.1)

    stop()
    raise EngineUnavailable(f"The engine did not start within {_START_TIMEOUT:.0f}s.")


def stop() -> None:
    """Stop the engine. Called when the editor exits."""
    global _process
    if _process is None:
        return
    if _process.poll() is None:
        _process.terminate()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
    _process = None


atexit.register(stop)


async def post(path: str, payload: Any) -> Dict[str, Any]:
    """POST to the engine, starting it if needed."""
    base = start()
    async with httpx.AsyncClient(timeout=None) as client:
        response = await client.post(f"{base}{path}", json=payload)
        response.raise_for_status()
        return response.json()


async def get(path: str) -> Dict[str, Any]:
    """GET from the engine, starting it if needed."""
    base = start()
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{base}{path}")
        response.raise_for_status()
        return response.json()
