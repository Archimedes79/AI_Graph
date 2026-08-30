"""
Shipping an interpreter with a build.

A built executable embeds the engine, but a code node is a subprocess and needs
a real interpreter -- which on Windows is often absent, because the `python.exe`
on PATH is the Microsoft Store stub. `--embed-python` closes that gap; these
tests cover the build-time half of it without touching the network.
"""

from __future__ import annotations

import importlib.util
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_python_embed():
    path = REPO_ROOT / "graph-runner" / "python_embed.py"
    spec = importlib.util.spec_from_file_location("graph_runner_python_embed", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _fake_distribution(root: Path) -> Path:
    """A directory shaped like python.org's embeddable package."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "python.exe").write_text("not really, but named like one")
    (root / "python314.zip").write_text("stdlib")
    (root / "LICENSE.txt").write_text("PSF")
    return root


def test_the_download_url_names_a_python_org_release():
    embed = _load_python_embed()
    assert embed.archive_url("3.14.3", "amd64") == (
        "https://www.python.org/ftp/python/3.14.3/python-3.14.3-embed-amd64.zip"
    )


def test_a_prepared_directory_can_be_shipped_instead_of_a_download(tmp_path):
    """The escape hatch: build offline, or from an archive you verified yourself."""
    embed = _load_python_embed()
    source = _fake_distribution(tmp_path / "prepared")

    packed = embed.provision(tmp_path / "build", str(source), log=lambda _: None)

    assert packed.name == embed.DIR_NAME
    assert (packed / "python.exe").is_file()
    # The interpreter's own licence has to travel with the binary that ships it.
    assert (packed / "LICENSE.txt").is_file()


def test_an_archive_that_wraps_its_files_in_a_folder_is_unwrapped(tmp_path):
    """
    python.org's archive has its files at the top level; one rolled by hand
    usually does not. Unwrapping here turns a silently broken executable -- an
    interpreter one directory too deep is simply never found -- into one that works.
    """
    embed = _load_python_embed()
    _fake_distribution(tmp_path / "staging" / "python-3.14.3-embed-amd64")
    archive = tmp_path / "wrapped.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        for path in (tmp_path / "staging").rglob("*"):
            bundle.write(path, path.relative_to(tmp_path / "staging"))

    packed = embed.provision(tmp_path / "build", str(archive), log=lambda _: None)

    assert (packed / "python.exe").is_file()


def test_a_directory_without_an_interpreter_is_refused(tmp_path):
    """Better to fail the build than to ship an executable that cannot run code."""
    embed = _load_python_embed()
    empty = tmp_path / "empty"
    empty.mkdir()
    (empty / "readme.txt").write_text("no interpreter here")

    with pytest.raises(RuntimeError, match="No interpreter found"):
        embed.provision(tmp_path / "build", str(empty), log=lambda _: None)


def test_a_missing_source_is_named_rather_than_downloaded_over(tmp_path):
    embed = _load_python_embed()
    with pytest.raises(RuntimeError, match="no such file or directory"):
        embed.provision(tmp_path / "build", str(tmp_path / "absent"), log=lambda _: None)


def test_reprovisioning_leaves_nothing_of_the_previous_interpreter(tmp_path):
    """A rebuild after switching versions must not ship a mix of the two."""
    embed = _load_python_embed()
    first = _fake_distribution(tmp_path / "first")
    (first / "stale.pyd").write_text("from the old version")
    embed.provision(tmp_path / "build", str(first), log=lambda _: None)

    second = _fake_distribution(tmp_path / "second")
    packed = embed.provision(tmp_path / "build", str(second), log=lambda _: None)

    assert not (packed / "stale.pyd").exists()


def test_a_deploy_bundle_can_ship_an_interpreter_too():
    """
    The README's promise ("needs no Python on the target machine") is about a
    deployed tool, not only the editor -- so the bundle's own build script has to
    have the same flag, and the module it uses.
    """
    from app.services.deploy_service import generate_deployment_bundle
    from app.models.graph import Graph

    graph = Graph.model_validate({
        "metadata": {"name": "tool"},
        "nodes": [{
            "id": "c", "node_type": "code", "label": "Work",
            "position": {"x": 0, "y": 0}, "inputs": [],
            "outputs": [{"id": "result", "name": "Out", "kind": "output",
                         "data_type": "any", "multi": False, "required": False}],
            "config": {"language": "python", "code": "def run(i):\n    return {}"},
        }],
        "edges": [],
    })
    bundle = generate_deployment_bundle(graph)

    assert "python_embed.py" in bundle
    assert "--embed-python" in bundle["build_exe.py"]
    # Vendored verbatim, like everything else in a bundle.
    assert bundle["python_embed.py"] == (
        REPO_ROOT / "graph-runner" / "python_embed.py"
    ).read_text(encoding="utf-8")
