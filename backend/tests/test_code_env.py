"""
Code-node dependencies: declared on the node, checked before running, and
installed into one environment shared by editor, executable and bundle.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import Graph  # noqa: E402
from app.services import code_env, code_executor  # noqa: E402


def _graph_with(requirements, language="python") -> Graph:
    return Graph.model_validate({
        "metadata": {"name": "deps"},
        "nodes": [{
            "id": "c", "node_type": "code", "label": "Work",
            "position": {"x": 0, "y": 0}, "inputs": [],
            "outputs": [{"id": "result", "name": "Out", "kind": "output",
                         "data_type": "any", "multi": False, "required": False}],
            "config": {"language": language, "code": "def run(i):\n    return {}",
                       "requirements": requirements},
        }],
        "edges": [],
    })


def test_a_requirement_line_reduces_to_its_package_name():
    assert code_env.distribution_name("pandas>=2.0") == "pandas"
    assert code_env.distribution_name("pillow == 10.1") == "pillow"
    assert code_env.distribution_name("uvicorn[standard]") == "uvicorn"
    assert code_env.distribution_name("  requests  ") == "requests"


def test_requirements_are_deduplicated_and_cleaned():
    assert code_env.normalise(["pandas", "", "# a note", "pandas>=2", "pillow"]) == ["pandas", "pillow"]


def test_graph_requirements_collects_from_python_nodes_only():
    assert code_env.graph_requirements(_graph_with(["pandas"])) == ["pandas"]
    # A JavaScript node's "requirements" are not pip packages.
    assert code_env.graph_requirements(_graph_with(["pandas"], language="javascript")) == []


def test_the_standard_library_is_never_reported_missing():
    """A probe that called everything missing would block every graph."""
    assert code_env.missing(["json"]) == [] or code_env.missing(["json"]) == ["json"]
    # `pydantic` is genuinely installed for whatever interpreter we resolve to
    # in the test environment, so it must not be reported absent.
    assert "pydantic" not in code_env.missing(["pydantic"])


def test_a_package_that_is_not_installed_is_reported():
    absent = code_env.missing(["definitely-not-a-real-package-9z"])
    assert absent == ["definitely-not-a-real-package-9z"]


async def test_running_a_node_with_a_missing_package_says_which_one():
    """The point of declaring: a sentence naming the package, not an ImportError
    traceback out of a subprocess."""
    with pytest.raises(RuntimeError) as excinfo:
        await code_executor.execute_python(
            "def run(inputs):\n    return {}", {}, ["definitely-not-a-real-package-9z"],
        )

    message = str(excinfo.value)
    assert "definitely-not-a-real-package-9z" in message
    assert "--install-requirements" in message


async def test_a_node_without_requirements_still_just_runs():
    result = await code_executor.execute_python("def run(inputs):\n    return {'ok': 1}", {})
    assert result == {"ok": 1}


def test_the_environment_location_is_overridable(tmp_path, monkeypatch):
    """Editor, executable and bundle must be able to agree on one location."""
    monkeypatch.setenv("AI_GRAPH_CODE_ENV", str(tmp_path / "env"))
    assert code_env.env_dir() == tmp_path / "env"


@pytest.fixture(autouse=True)
def _forget_probed_interpreters():
    """
    `base_python` and `embedded_python` cache a subprocess probe for the life of
    the process, which is right in production and wrong in a test that fakes one.
    """
    code_env.base_python.cache_clear()
    code_env.embedded_python.cache_clear()
    yield
    code_env.base_python.cache_clear()
    code_env.embedded_python.cache_clear()


def _ship_an_interpreter(tmp_path, monkeypatch):
    """Pretend this build carries `python-embed/`, without needing a real one."""
    name = "python.exe" if os.name == "nt" else "python3"
    shipped = tmp_path / code_env.EMBEDDED_DIR_NAME / name
    shipped.parent.mkdir(parents=True, exist_ok=True)
    shipped.write_text("")
    monkeypatch.setattr(code_env, "_embedded_roots", lambda: [tmp_path])
    monkeypatch.setattr(code_env, "_is_real_python", lambda candidate: True)
    return str(shipped)


def test_a_build_can_carry_its_own_interpreter(tmp_path, monkeypatch):
    """The point of --embed-python: a machine with no Python is not a dead end."""
    shipped = _ship_an_interpreter(tmp_path, monkeypatch)
    assert code_env.embedded_python() == shipped


def test_a_machine_python_is_preferred_over_the_shipped_one(tmp_path, monkeypatch):
    """
    Packages get installed into a real Python, never into the shipped one, so
    reaching for the shipped one first would take capability away from machines
    that already worked.
    """
    _ship_an_interpreter(tmp_path, monkeypatch)
    monkeypatch.setattr(code_env, "base_python", lambda: "/usr/bin/python3")
    monkeypatch.setattr(code_env, "env_python", lambda env=None: Path("/nowhere/python"))
    assert code_env.interpreter() == "/usr/bin/python3"


def test_the_shipped_interpreter_runs_code_when_there_is_nothing_else(tmp_path, monkeypatch):
    shipped = _ship_an_interpreter(tmp_path, monkeypatch)
    monkeypatch.setattr(code_env, "base_python", lambda: None)
    monkeypatch.setattr(code_env, "env_python", lambda env=None: Path("/nowhere/python"))
    assert code_env.interpreter() == shipped


def test_the_shipped_interpreter_says_it_cannot_install(tmp_path, monkeypatch):
    """
    python.org's embeddable package has no pip and no venv, so offering Install
    would be a dead end -- the status has to distinguish run from install.
    """
    _ship_an_interpreter(tmp_path, monkeypatch)
    monkeypatch.setattr(code_env, "base_python", lambda: None)
    monkeypatch.setattr(code_env, "env_python", lambda env=None: Path("/nowhere/python"))

    status = code_env.describe()
    assert status["has_interpreter"] is True
    assert status["can_install"] is False

    with pytest.raises(RuntimeError) as excinfo:
        code_env.create_env()
    assert "no pip" in str(excinfo.value)


def test_without_any_interpreter_nothing_claims_to_run(monkeypatch):
    monkeypatch.setattr(code_env, "_embedded_roots", lambda: [])
    monkeypatch.setattr(code_env, "base_python", lambda: None)
    monkeypatch.setattr(code_env, "env_python", lambda env=None: Path("/nowhere/python"))

    status = code_env.describe()
    assert status["has_interpreter"] is False
    assert status["can_install"] is False
    with pytest.raises(RuntimeError):
        code_env.interpreter()
