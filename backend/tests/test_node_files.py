"""
A node's authored text as a real file beside the graph.

One mechanism for every node type: each element declares what it authors
(`authored_file`), and everything here is parameterised by that. These tests are
therefore mostly about the *shared* behaviour, plus one case per element proving
the declaration is wired up.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.registry import NODE_ELEMENTS  # noqa: E402
from app.models.graph import Graph  # noqa: E402
from app.services import node_files  # noqa: E402


def _node(node_type="code", label="Analyse", **config):
    graph = Graph.model_validate({
        "metadata": {"name": "g"},
        "nodes": [{
            "id": f"{node_type}-1", "node_type": node_type, "label": label,
            "description": config.pop("description", ""),
            "position": {"x": 0, "y": 0},
            "inputs": [{"id": "text", "name": "Text", "kind": "input",
                        "data_type": "text", "multi": False, "required": False}],
            "outputs": [{"id": "result", "name": "Out", "kind": "output",
                         "data_type": "any", "multi": False, "required": False}],
            "config": config,
        }],
        "edges": [],
    })
    node = graph.nodes[0]
    return node, NODE_ELEMENTS[node.node_type].authored_file(node)


# --- the symmetry -----------------------------------------------------------

@pytest.mark.parametrize("node_type,body_field,extension", [
    ("code", "code", ".py"),
    ("ai", "system_prompt", ".md"),
    ("data", "data_format_prompt", ".md"),
])
def test_each_element_declares_what_it_authors(node_type, body_field, extension):
    _, spec = _node(node_type)
    assert spec is not None
    assert spec.body_field == body_field
    assert spec.extension == extension


@pytest.mark.parametrize("node_type", ["input", "output"])
def test_a_node_with_nothing_authored_has_no_file(node_type):
    _, spec = _node(node_type)
    assert spec is None


@pytest.mark.parametrize("node_type,body,prompt", [
    ("code", "def run(inputs):\n    return {}", "code_prompt"),
    ("ai", "You are a careful assistant.", "description"),
    ("data", "ts: ISO-8601\nwert: float", "data_prompt"),
])
def test_every_element_round_trips_through_a_file(node_type, body, prompt):
    """Render then parse then apply must return exactly what went in -- for all
    of them, through the same code."""
    node, spec = _node(node_type, **{spec_field: value for spec_field, value in
                                     [(prompt, "Die Absicht dahinter.")]})
    node_files.set_body(node, spec, body)
    name = node_files.default_file_name(node.label, spec.extension)

    header, parsed_body = node_files.parse(node_files.render(node, spec, name), name)
    node_files.apply_to_node(node, spec, header, parsed_body)

    assert node_files.get_body(node, spec) == body
    assert node_files.get_prompt(node, spec) == "Die Absicht dahinter."
    assert header["id"] == f"{node_type}-1"


# --- names ------------------------------------------------------------------

def test_the_file_is_named_after_the_node():
    assert node_files.default_file_name("Analyse", ".py") == "Analyse.py"
    assert node_files.default_file_name("Analyse", ".md") == "Analyse.md"


def test_a_label_a_filesystem_would_reject_still_yields_a_name():
    assert node_files.default_file_name("Werte / 2024: roh?", ".py") == "Werte_2024_roh.py"
    assert node_files.default_file_name("***", ".py") == "node.py"


def test_two_nodes_with_the_same_label_do_not_collide():
    assert node_files.default_file_name("Analyse", ".py", {"Analyse.py"}) == "Analyse_2.py"


# --- the header per file kind ----------------------------------------------

def test_a_python_file_fences_the_header_in_comments():
    node, spec = _node("code", code="def run(inputs):\n    return {}", code_prompt="Zähle die Wörter.")
    text = node_files.render(node, spec, "Analyse.py")

    assert text.startswith("# --- ai-graph ---")
    assert "# node:    Analyse" in text
    assert "#   Zähle die Wörter." in text
    assert "# inputs:  text" in text
    assert text.rstrip().endswith("return {}")


def test_a_javascript_file_uses_javascript_comments():
    node, spec = _node("code", language="javascript", code="function run(i){return {}}")
    text = node_files.render(node, spec, "Analyse.js")
    assert text.startswith("// --- ai-graph ---")
    assert "// node:    Analyse" in text


def test_a_markdown_file_uses_front_matter_because_hash_is_a_heading():
    node, spec = _node("ai", system_prompt="You are careful.", description="Sei vorsichtig.")
    text = node_files.render(node, spec, "Assistent.md")

    assert text.startswith("---\n")
    assert "node:    Analyse" in text
    assert "#" not in text.split("\n\n")[0]  # no comment prefix in the header
    assert text.rstrip().endswith("You are careful.")


# --- what is allowed back ---------------------------------------------------

def test_authored_fields_flow_back_into_the_node():
    node, spec = _node("code", code="alt", code_prompt="alt")
    header, body = node_files.parse(
        "# --- ai-graph ---------\n"
        "# node:    Neuer Name\n"
        "# id:      code-1\n"
        "# prompt: |\n"
        "#   Ein neuer Prompt\n"
        "# context-file: neu.csv\n"
        "# ------------------------\n"
        "\n"
        "def run(inputs):\n    return {'a': 1}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, spec, header, body)

    assert node.label == "Neuer Name"
    assert node.config.code_prompt == "Ein neuer Prompt"
    assert node.config.config_context_file == "neu.csv"
    assert node.config.code == "def run(inputs):\n    return {'a': 1}"


def test_ports_in_the_header_are_read_only():
    """A text file renaming a port would silently break every edge into it."""
    node, spec = _node("code")
    header, body = node_files.parse(
        "# --- ai-graph ---------\n"
        "# node:    Analyse\n"
        "# id:      code-1\n"
        "# inputs:  etwas_ganz_anderes\n"
        "# outputs: auch_anders\n"
        "# ------------------------\n"
        "\ndef run(inputs):\n    return {}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, spec, header, body)

    assert [p.id for p in node.inputs] == ["text"]
    assert [p.id for p in node.outputs] == ["result"]


def test_the_id_is_never_applied():
    node, spec = _node("code")
    header, body = node_files.parse(
        "# --- ai-graph --------\n# node: Analyse\n# id: eine-andere-id\n# ------------------------\n\ndef run(i):\n    return {}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, spec, header, body)
    assert node.id == "code-1"


def test_a_hand_written_file_without_a_header_is_all_body():
    """Being lenient is what lets a person write one of these from scratch."""
    header, body = node_files.parse("def run(inputs):\n    return {'x': 1}\n", "Analyse.py")
    assert header == {}
    assert body == "def run(inputs):\n    return {'x': 1}"
