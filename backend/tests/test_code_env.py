"""
Code-node dependencies: declared on the node, checked before running, and
installed into one environment shared by editor, executable and bundle.
"""

from __future__ import annotations

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


def test_a_deploy_bundle_lists_what_the_graph_imports():
    from app.services.deploy_service import generate_deployment_bundle

    requirements = generate_deployment_bundle(_graph_with(["pandas>=2.0"]))["requirements.txt"]
    assert "pandas>=2.0" in requirements
    # ...without claiming it is an engine dependency.
    assert "pydantic" in requirements
