#!/usr/bin/env python3
"""
The Python interpreter a build carries with it.

A built executable embeds the engine, but a Python code node is a *subprocess*:
it needs a real interpreter on the machine it lands on, and on Windows there
often is none. The `python.exe` on PATH is usually the Microsoft Store stub,
which opens a store page instead of running anything -- so the one promise the
executable made that mattered ("needs no Python on the target machine") was
false for exactly the graphs that do the interesting work.

This module fetches python.org's official *embeddable* package at build time so
a build can ship an interpreter of its own. `code_env.embedded_python()` is the
other half: it finds the result at run time and uses it only when the machine
offers nothing better.

What ships is a STDLIB-ONLY interpreter -- json, csv, sqlite3, pathlib, urllib
and the rest, but no `pip` and no `venv`. That is how python.org builds the
embeddable package, not a decision made here, and it draws the line cleanly: a
code node that imports only the standard library now runs anywhere, while one
that declares `pandas` still needs a real Python installed. The package's own
LICENSE.txt travels inside the directory, so the terms ship with the binary.

Used by `build_editor_exe.py --embed-python` and by this bundle's
`build_exe.py --embed-python`; it is build tooling and never runs during a graph.
"""

from __future__ import annotations

import platform
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# The directory name both build scripts write and code_env.embedded_python()
# looks for. Changing it means changing both ends.
DIR_NAME = "python-embed"

# Downloads land here rather than in the repo: a build is often repeated, the
# archive is ~12 MB, and this is the same `~/.ai-graph` the code-node
# environment already uses, so there is one place to clear rather than two.
CACHE_DIR = Path.home() / ".ai-graph" / "python-embed-cache"

# python.org publishes the embeddable package for Windows only. Elsewhere a
# real python3 is effectively always present (and no Store stub exists to be
# mistaken for one), which is why this gap only ever bit on Windows.
_ARCH_SUFFIX = {"amd64": "amd64", "x86_64": "amd64", "arm64": "arm64", "x86": "win32", "i386": "win32"}


def archive_url(version: str, arch: str) -> str:
    """The python.org URL for an embeddable package, e.g. 3.14.3 / amd64."""
    return f"https://www.python.org/ftp/python/{version}/python-{version}-embed-{arch}.zip"


def _arch() -> str:
    machine = platform.machine().lower()
    suffix = _ARCH_SUFFIX.get(machine)
    if suffix is None:
        raise RuntimeError(f"No embeddable Python is published for this architecture ({machine}).")
    return suffix


def _download(version: str, arch: str, log) -> Path:
    """
    Fetch the embeddable archive into the cache and return it.

    Trust rests on HTTPS to python.org, the same as `pip install` -- the URL and
    the size are printed so a build can be checked against the published
    release. Pass --embed-python <path> instead to build from an archive you
    verified yourself, or to build offline.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    url = archive_url(version, arch)
    cached = CACHE_DIR / url.rsplit("/", 1)[-1]
    if cached.is_file():
        log(f"using cached {cached.name} ({cached.stat().st_size / 1e6:.1f} MB)")
        return cached

    log(f"downloading {url}")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 - fixed https host
            payload = response.read()
    except Exception as exc:  # noqa: BLE001 - every failure here has the same answer
        raise RuntimeError(
            f"Could not download {url}: {exc}\n"
            "Download it yourself and pass it with --embed-python <path-to-zip>."
        ) from exc

    # Write beside the target and move into place, so an interrupted download
    # cannot leave a truncated archive in the cache to be reused forever.
    partial = cached.with_suffix(".part")
    partial.write_bytes(payload)
    partial.replace(cached)
    log(f"cached {cached.name} ({len(payload) / 1e6:.1f} MB)")
    return cached


def _extract(archive: Path, dest: Path) -> None:
    """
    Unpack *archive* so that the interpreter sits directly in *dest*.

    python.org's archive has its files at the top level, but an archive rolled
    by hand usually wraps them in one directory; unwrapping that here turns a
    silently broken build into one that just works.
    """
    with tempfile.TemporaryDirectory() as scratch:
        staged = Path(scratch) / "unpacked"
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(staged)
        entries = list(staged.iterdir())
        root = entries[0] if len(entries) == 1 and entries[0].is_dir() else staged
        shutil.copytree(root, dest)


def provision(parent: Path, source: str = "", version: str = "", log=None) -> Path:
    """
    Put a ready-to-ship `python-embed/` under *parent* and return its path.

    *source* empty or "auto" downloads the archive matching the interpreter
    running this build -- shipping the version the graph was developed against
    is the point, so it is not a separate choice. Otherwise *source* is a `.zip`
    or an already-unpacked directory.
    """
    log = log or (lambda message: print(f"[python-embed] {message}"))
    dest = Path(parent) / DIR_NAME
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    wanted = (source or "").strip()
    if wanted and wanted.lower() != "auto":
        origin = Path(wanted).expanduser()
        if origin.is_dir():
            log(f"copying {origin}")
            shutil.copytree(origin, dest)
        elif origin.is_file():
            log(f"unpacking {origin}")
            _extract(origin, dest)
        else:
            raise RuntimeError(f"--embed-python: no such file or directory: {origin}")
    else:
        if sys.platform != "win32":
            raise RuntimeError(
                "An embeddable Python is only published for Windows. On this platform "
                "pass a prepared interpreter directory with --embed-python <path> "
                "(python-build-standalone publishes one), or leave the flag off: "
                "a real python3 is normally present here anyway."
            )
        _extract(_download(version or platform.python_version(), _arch(), log), dest)

    if not any(dest.glob("python*")):
        raise RuntimeError(
            f"No interpreter found in {dest} after unpacking -- expected a python "
            "executable at the top level of the archive or directory."
        )
    size = sum(f.stat().st_size for f in dest.rglob("*") if f.is_file())
    log(f"ready: {dest} ({size / 1e6:.1f} MB)")
    return dest

