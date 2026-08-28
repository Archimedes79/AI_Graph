"""
The Python environment that code nodes run in.

A code node runs its snippet in a subprocess, so everything it can import is
decided by *which interpreter that is*. Left to itself that answer differed per
context: the editor used the backend's own virtualenv (so a snippet could import
httpx and fastapi by accident, but not pandas), while a frozen build searched
PATH and found whatever the machine happened to have -- often, on Windows, only
the Microsoft Store stub, which is not an interpreter at all. The same graph
therefore behaved differently in the editor and in the executable built from it,
and a deploy bundle's requirements.txt listed what the *engine* needed while
saying nothing about what the *graph* imported.

So there is one managed environment, shared by the editor, the CLI, a frozen
build and a deploy bundle: a plain `venv` (no containers, no package manager of
our own) at `~/.ai-graph/code-env`, or wherever `AI_GRAPH_CODE_ENV` points. A
graph declares what it needs on its code nodes (`config.requirements`), and
those packages are installed into that one environment.

Deliberately NOT automatic: nothing here installs anything as a side effect of
running a graph. Installing packages is a decision, sometimes a slow one and
always a network one, so it is an explicit action -- the editor's Install
button, or `python main.py --install-requirements` for a bundle. What execution
does instead is check first and fail with a sentence that names the missing
package, rather than a raw ImportError traceback from a subprocess.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Installing can compile wheels; a per-package minute is not unusual.
INSTALL_TIMEOUT = int(os.getenv("AI_GRAPH_INSTALL_TIMEOUT", "900"))
PROBE_TIMEOUT = 30

# Env vars a child interpreter needs to start, but nothing else -- no API keys.
# Kept in step with code_executor._SUBPROCESS_ENV_ALLOWLIST deliberately: this
# module also launches interpreters.
_ENV_ALLOWLIST = {
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
    "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL", "APPDATA", "LOCALAPPDATA",
}

NO_INTERPRETER_MESSAGE = (
    "Python code nodes need a Python interpreter, and none was found. Install "
    "Python from python.org and make sure it is on PATH -- the Microsoft Store "
    "stub that Windows puts there by default is not one. (A JavaScript code node "
    "needs Node.js instead.)"
)


def _child_env() -> Dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.upper() in _ENV_ALLOWLIST}


def distribution_name(requirement: str) -> str:
    """
    The package name out of a requirement line: `pandas>=2.0` -> `pandas`.

    Checking installs by distribution name rather than import name is what keeps
    `pillow` (imported as `PIL`) and `beautifulsoup4` (as `bs4`) from being
    reported missing when they are installed.
    """
    return re.split(r"[<>=!~;\[\s]", requirement.strip(), maxsplit=1)[0].strip()


def normalise(requirements: Iterable[str]) -> List[str]:
    """Deduplicate and drop blanks/comments, preserving the order first seen."""
    seen = set()
    result: List[str] = []
    for raw in requirements or []:
        text = str(raw).strip()
        if not text or text.startswith("#"):
            continue
        key = distribution_name(text).lower()
        if key and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _is_real_python(candidate: str) -> bool:
    """
    Whether *candidate* actually runs Python. Windows ships a `python.exe` App
    Execution Alias that only advertises the Microsoft Store, and `shutil.which`
    returns it happily -- so a name on PATH is not evidence of an interpreter.
    """
    try:
        probe = subprocess.run(
            [candidate, "-c", "print(1)"],
            capture_output=True, timeout=15, env=_child_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return probe.returncode == 0 and probe.stdout.decode(errors="replace").strip() == "1"


@functools.lru_cache(maxsize=1)
def base_python() -> Optional[str]:
    """
    A real interpreter to build the managed environment from, or None.

    In a PyInstaller build `sys.executable` is the packaged tool itself, so using
    it would relaunch the tool instead of running a snippet; a frozen build has
    to find a real Python on PATH. Cached: this probes subprocesses and the
    answer cannot change while the process lives.
    """
    if not getattr(sys, "frozen", False):
        return sys.executable
    for name in ("python", "python3", "py"):
        found = shutil.which(name)
        if found and _is_real_python(found):
            return found
    return None


def env_dir() -> Path:
    """
    Where the managed environment lives.

    One location for every entry point, rather than one per build kind: that is
    the whole point -- the editor and the executable built from it must run code
    nodes in the same environment, or a graph that works in one fails in the other.
    """
    override = os.getenv("AI_GRAPH_CODE_ENV", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".ai-graph" / "code-env"


def env_python(env: Optional[Path] = None) -> Path:
    env = env or env_dir()
    return env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def interpreter() -> str:
    """
    The interpreter a code node runs in: the managed environment when it exists,
    otherwise the base Python. Raises when there is no interpreter at all.
    """
    explicit = os.getenv("AI_GRAPH_CODE_PYTHON", "").strip()
    if explicit:
        return explicit

    managed = env_python()
    if managed.is_file():
        return str(managed)

    base = base_python()
    if base is None:
        raise RuntimeError(NO_INTERPRETER_MESSAGE)
    return base


def missing(requirements: Iterable[str]) -> List[str]:
    """
    Which of *requirements* are not installed for the interpreter code nodes use.

    Asks the target interpreter rather than this process: they are usually
    different, which is exactly the confusion this module exists to remove.
    """
    wanted = normalise(requirements)
    if not wanted:
        return []

    names = [distribution_name(r) for r in wanted]
    probe = (
        "import json,sys\n"
        "try:\n"
        "    from importlib.metadata import distribution, PackageNotFoundError\n"
        "except ImportError:\n"
        "    print(json.dumps(sys.argv[1:])); raise SystemExit\n"
        "absent=[]\n"
        "for name in sys.argv[1:]:\n"
        "    try: distribution(name)\n"
        "    except Exception: absent.append(name)\n"
        "print(json.dumps(absent))\n"
    )
    try:
        result = subprocess.run(
            [interpreter(), "-c", probe, *names],
            capture_output=True, timeout=PROBE_TIMEOUT, env=_child_env(),
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Could not check installed packages: %s", exc)
        return wanted

    if result.returncode != 0:
        return wanted
    try:
        absent = set(json.loads(result.stdout.decode(errors="replace").strip() or "[]"))
    except json.JSONDecodeError:
        return wanted
    return [r for r in wanted if distribution_name(r) in absent]


def create_env() -> Path:
    """Create the managed virtualenv if it is not there yet, and return its path."""
    env = env_dir()
    if env_python(env).is_file():
        return env

    base = base_python()
    if base is None:
        raise RuntimeError(NO_INTERPRETER_MESSAGE)

    env.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Creating the code-node environment at %s", env)
    result = subprocess.run(
        [base, "-m", "venv", str(env)],
        capture_output=True, timeout=INSTALL_TIMEOUT, env=_child_env(),
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Could not create the code-node environment at {env}: "
            f"{result.stderr.decode(errors='replace').strip()}"
        )
    return env


def install(requirements: Iterable[str]) -> Tuple[List[str], str]:
    """
    Install *requirements* into the managed environment.

    Returns `(installed, log)`. Creating the environment on first use is part of
    this call rather than of running a graph: it is slow and needs the network,
    which is not something a Run button should do behind the user's back.
    """
    wanted = normalise(requirements)
    if not wanted:
        return [], "Nothing to install."

    env = create_env()
    python = str(env_python(env))
    logger.info("Installing into %s: %s", env, ", ".join(wanted))

    result = subprocess.run(
        [python, "-m", "pip", "install", "--disable-pip-version-check", *wanted],
        capture_output=True, timeout=INSTALL_TIMEOUT, env=_child_env(),
    )
    log = (result.stdout + b"\n" + result.stderr).decode(errors="replace").strip()
    if result.returncode != 0:
        raise RuntimeError(f"pip install failed:\n{log[-4000:]}")
    return wanted, log


def describe() -> Dict[str, object]:
    """What the editor shows: where the environment is and whether it exists."""
    env = env_dir()
    base = base_python()
    return {
        "env_dir": str(env),
        "env_exists": env_python(env).is_file(),
        "base_python": base or "",
        "has_interpreter": base is not None or env_python(env).is_file(),
    }


def graph_requirements(graph) -> List[str]:
    """Every requirement declared by any Python code node in *graph*."""
    collected: List[str] = []
    for node in graph.nodes:
        if getattr(node.config, "language", "python") != "python":
            continue
        collected.extend(getattr(node.config, "requirements", None) or [])
    return normalise(collected)
