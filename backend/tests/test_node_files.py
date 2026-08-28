"""
A node's code as a real file beside the graph: the header format, and what of it
is allowed to flow back into the graph.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import Graph  # noqa: E402
from app.services import node_files  # noqa: E402


def _code_node(**config):
    graph = Graph.model_validate({
        "metadata": {"name": "g"},
        "nodes": [{
            "id": "code-1", "node_type": "code", "label": "Analyse",
            "position": {"x": 0, "y": 0},
            "inputs": [{"id": "text", "name": "Text", "kind": "input",
                        "data_type": "text", "multi": False, "required": False}],
            "outputs": [{"id": "result", "name": "Out", "kind": "output",
                         "data_type": "any", "multi": False, "required": False}],
            "config": {"language": "python", "code": "def run(inputs):\n    return {}", **config},
        }],
        "edges": [],
    })
    return graph.nodes[0]


# --- names ------------------------------------------------------------------

def test_the_file_is_named_after_the_node():
    assert node_files.default_file_name("Analyse", "python") == "Analyse.py"
    assert node_files.default_file_name("Analyse", "javascript") == "Analyse.js"


def test_a_label_a_filesystem_would_reject_still_yields_a_name():
    assert node_files.default_file_name("Werte / 2024: roh?", "python") == "Werte_2024_roh.py"
    assert node_files.default_file_name("***", "python") == "node.py"


def test_two_nodes_with_the_same_label_do_not_collide():
    assert node_files.default_file_name("Analyse", "python", {"Analyse.py"}) == "Analyse_2.py"


# --- round trip -------------------------------------------------------------

def test_the_header_carries_the_prompt_and_the_code_follows_it():
    node = _code_node(code_prompt="Zähle die Wörter.\nGib sie als Zahl zurück.",
                      config_context_file="examples/bev_data.csv")
    text = node_files.render(node, "Analyse.py")

    assert text.startswith("# --- ai-graph ---")
    assert "# node:    Analyse" in text
    assert "# id:      code-1" in text
    assert "#   Zähle die Wörter." in text
    assert "# context-file: examples/bev_data.csv" in text
    assert "# inputs:  text" in text
    assert text.rstrip().endswith("return {}")


def test_a_javascript_node_uses_javascript_comments():
    node = _code_node(language="javascript", code_prompt="tu was")
    text = node_files.render(node, "Analyse.js")
    assert text.startswith("// --- ai-graph ---")
    assert "// node:    Analyse" in text


def test_render_then_parse_returns_what_went_in():
    node = _code_node(code_prompt="Erste Zeile\nZweite Zeile", config_context_file="daten.csv")
    header, body = node_files.parse(node_files.render(node, "Analyse.py"), "Analyse.py")

    assert header["node"] == "Analyse"
    assert header["id"] == "code-1"
    assert header["prompt"] == "Erste Zeile\nZweite Zeile"
    assert header["context-file"] == "daten.csv"
    assert body == "def run(inputs):\n    return {}"


# --- what is allowed back ---------------------------------------------------

def test_authored_fields_flow_back_into_the_node():
    node = _code_node()
    header, body = node_files.parse(
        "# --- ai-graph ---------\n"
        "# node:    Neuer Name\n"
        "# id:      code-1\n"
        "# prompt: |\n"
        "#   Ein neuer Prompt\n"
        "# context-file: neu.csv\n"
        "# ---------------------\n"
        "\n"
        "def run(inputs):\n    return {'a': 1}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, header, body)

    assert node.label == "Neuer Name"
    assert node.config.code_prompt == "Ein neuer Prompt"
    assert node.config.config_context_file == "neu.csv"
    assert node.config.code == "def run(inputs):\n    return {'a': 1}"


def test_ports_in_the_header_are_read_only():
    """A text file renaming a port would silently break every edge into it."""
    node = _code_node()
    header, body = node_files.parse(
        "# --- ai-graph ---------\n"
        "# node:    Analyse\n"
        "# id:      code-1\n"
        "# inputs:  etwas_ganz_anderes\n"
        "# outputs: auch_anders\n"
        "# ---------------------\n"
        "\n"
        "def run(inputs):\n    return {}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, header, body)

    assert [p.id for p in node.inputs] == ["text"]
    assert [p.id for p in node.outputs] == ["result"]


def test_the_id_is_never_applied():
    node = _code_node()
    header, body = node_files.parse(
        "# --- ai-graph ---\n# node: Analyse\n# id: eine-andere-id\n# ---\n\ndef run(i):\n    return {}\n",
        "Analyse.py",
    )
    node_files.apply_to_node(node, header, body)
    assert node.id == "code-1"


def test_a_hand_written_file_without_a_header_is_all_body():
    """Being lenient is what lets a person write one of these from scratch."""
    header, body = node_files.parse("def run(inputs):\n    return {'x': 1}\n", "Analyse.py")
    assert header == {}
    assert body == "def run(inputs):\n    return {'x': 1}"
