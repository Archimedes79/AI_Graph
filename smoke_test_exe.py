#!/usr/bin/env python3
"""
Smoke-test a built AI-Graph editor executable.

    python smoke_test_exe.py dist/ai-graph.exe
    python smoke_test_exe.py dist/ai-graph.exe --standalone
    python smoke_test_exe.py dist/ai-graph.exe --port 8130

This tests the ARTIFACT people actually download, not the source it was built
from: it starts the executable, drives it over HTTP, and shuts it down.

Two modes, because the executable makes two different promises:

  default      Everything works, including Python code nodes -- which shell out
               to a `python` on PATH (see code_executor._python_interpreter).
  --standalone The exe is launched with every Python directory stripped from
               PATH, proving the EDITOR itself needs no Python to boot and
               serve. Code-node execution is deliberately not asserted here;
               that is the one capability documented as needing an interpreter
               on the target machine.

Exits non-zero on the first failed check, printing what was expected.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
EXAMPLES = REPO_ROOT / "examples"

STARTUP_TIMEOUT = 120.0


class Checks:
    """Collects pass/fail lines so one run reports every result, not just the first."""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0

    def check(self, name: str, got, want) -> None:
        if got == want:
            print(f"  PASS  {name}")
            self.passed += 1
        else:
            print(f"  FAIL  {name}\n          got:  {got!r}\n          want: {want!r}")
            self.failed += 1

    def ok(self, name: str, condition: bool, detail: str = "") -> None:
        self.check(name, bool(condition) or detail or False, True)


def _request(url: str, payload: bytes | None = None, timeout: float = 300.0):
    """GET, or POST when `payload` is given. Returns (status, body_bytes)."""
    req = urllib.request.Request(url, data=payload)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _child_env(standalone: bool) -> dict[str, str]:
    """
    The environment the executable is launched with. In --standalone mode every
    PATH entry that looks like a Python installation is removed, so the exe has
    to stand on its own embedded runtime.
    """
    env = dict(os.environ)
    if not standalone:
        return env

    sep = os.pathsep
    kept = [
        entry for entry in env.get("PATH", "").split(sep)
        if entry and "python" not in entry.lower()
    ]
    env["PATH"] = sep.join(kept)
    return env


def _terminate_tree(process: subprocess.Popen) -> None:
    """
    Stop the executable and everything it spawned.

    A PyInstaller --onefile binary is a bootloader that unpacks itself and runs
    the real application as a CHILD process. Terminating what we launched kills
    only the bootloader; the server keeps running, keeps the port bound, and --
    because it inherited our stdout -- keeps the pipe open, so a CI job hangs
    forever instead of failing. Kill the whole tree.
    """
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(process.pid)],
            capture_output=True, check=False,
        )
    else:
        import signal
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            process.terminate()
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        process.kill()


def _wait_for_health(base: str, process: subprocess.Popen) -> bool:
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            print(f"[smoke] executable exited early with code {process.returncode}", file=sys.stderr)
            return False
        try:
            status, _ = _request(f"{base}/health", timeout=5)
            if status == 200:
                return True
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
        time.sleep(1.0)
    print(f"[smoke] executable did not answer /health within {STARTUP_TIMEOUT:.0f}s", file=sys.stderr)
    return False


def _execute_graph(base: str, graph_name: str) -> dict:
    payload = (EXAMPLES / graph_name).read_bytes()
    _, body = _request(f"{base}/api/execute/", payload)
    return json.loads(body)


def run_checks(base: str, standalone: bool, tmp_dir: Path) -> Checks:
    c = Checks()

    status, body = _request(f"{base}/health")
    c.check("health endpoint", (status, json.loads(body).get("status")), (200, "ok"))

    status, body = _request(f"{base}/")
    c.check("/ serves the built UI", (status, body[:15].decode(errors="replace").lower()), (200, "<!doctype html>"))

    status, _ = _request(f"{base}/runtime.html")
    c.check("runtime.html (deployed-GUI page) is served", status, 200)

    status, _ = _request(f"{base}/docs")
    c.check("API docs reachable", status, 200)

    result = _execute_graph(base, "hello_world.json")
    c.check("graph without a code node executes", result.get("status"), "success")

    # A deploy bundle is assembled by reading the vendored engine's .py files as
    # TEXT, which a frozen build can only do if it ships them as data -- so this
    # is the check that catches a packaging regression, not just a broken route.
    bundle_path = tmp_dir / "smoke_bundle.zip"
    status, body = _request(f"{base}/api/deploy/bundle", (EXAMPLES / "text_transform.json").read_bytes())
    bundle_path.write_bytes(body)
    c.check("deploy bundle exports", status, 200)

    with zipfile.ZipFile(bundle_path) as z:
        names = z.namelist()
        for required in ("graph.json", "main.py", "requirements.txt", "app/services/graph_executor.py"):
            c.check(f"bundle contains {required}", required in names, True)

        vendored = z.read("app/services/graph_executor.py").decode("utf-8")
        source = (REPO_ROOT / "backend" / "app" / "services" / "graph_executor.py").read_text(encoding="utf-8")
        c.check("vendored engine is byte-identical to the repo's", vendored == source, True)

        vendored_main = z.read("main.py").decode("utf-8")
        runner = (REPO_ROOT / "graph-runner" / "run.py").read_text(encoding="utf-8")
        c.check("bundle main.py is graph-runner/run.py verbatim", vendored_main == runner, True)

    if standalone:
        print("  ----  code-node execution not asserted (--standalone: no Python on PATH by design)")
    else:
        result = _execute_graph(base, "text_transform.json")
        transform = next((n for n in result.get("node_results", []) if n["node_id"] == "transform"), {})
        c.check("Python code node executes", result.get("status"), "success")
        c.check("code node produced its output", transform.get("outputs", {}).get("word_count"), 9)

    return c


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("executable", type=Path, help="path to the built executable")
    parser.add_argument("--port", type=int, default=8137, help="port to run it on (default: 8137)")
    parser.add_argument(
        "--standalone", action="store_true",
        help="launch with Python stripped from PATH; skips the code-node check",
    )
    args = parser.parse_args()

    exe = args.executable.resolve()
    if not exe.is_file():
        print(f"[smoke] not a file: {exe}", file=sys.stderr)
        return 1
    if not os.access(exe, os.X_OK) and sys.platform != "win32":
        exe.chmod(0o755)

    base = f"http://127.0.0.1:{args.port}"
    env = _child_env(args.standalone)
    env["AI_GRAPH_PORT"] = str(args.port)
    # Nothing in this test opens a browser; a CI runner has none to open.
    env["AI_GRAPH_NO_BROWSER"] = "1"

    mode = "standalone (no Python on PATH)" if args.standalone else "full"
    print(f"[smoke] {exe.name} on {base}  --  mode: {mode}")

    tmp_dir = exe.parent / "_smoke"
    tmp_dir.mkdir(exist_ok=True)

    # Its own process group on POSIX, so _terminate_tree can signal the group;
    # on Windows taskkill /T walks the tree by PID and needs no flag here.
    popen_kwargs = {} if sys.platform == "win32" else {"start_new_session": True}
    process = subprocess.Popen([str(exe)], env=env, cwd=str(tmp_dir), **popen_kwargs)
    try:
        if not _wait_for_health(base, process):
            return 1
        checks = run_checks(base, args.standalone, tmp_dir)
    finally:
        _terminate_tree(process)

    print(f"\n[smoke] {checks.passed} passed, {checks.failed} failed")
    return 1 if checks.failed else 0


if __name__ == "__main__":
    sys.exit(main())
