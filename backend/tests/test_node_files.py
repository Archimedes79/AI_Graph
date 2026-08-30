"""
Authored text as a real file beside the graph.

One mechanism for nodes AND widgets: each element declares what it authors
(`authored_file`), `node_files.Authored` is the single view of "a thing with a
name and some text somebody wrote", and every function takes one of those
without learning which of the two levels it came from. These tests are therefore
mostly about the shared behaviour, plus one case per element proving its
declaration is wired up.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.registry import GUI_WIDGET_ELEMENTS, NODE_ELEMENTS  # noqa: E402
from app.models.graph import (Graph, GraphNode, GuiWidget, GuiWidgetKind, NodeConfig,  # noqa: E402
                              NodeType, Port, PortKind)
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
    spec = NODE_ELEMENTS[node.node_type].authored_file(node)
    return node, (node_files.for_node(node, spec) if spec else None)


def _widget(kind="plot_window", label="Verlauf", **fields):
    widget = GuiWidget(id="w1", kind=kind, label=label, **fields)
    spec = GUI_WIDGET_ELEMENTS[GuiWidgetKind(kind)].authored_file(widget)
    return widget, (node_files.for_widget(widget, spec) if spec else None)


# --- the symmetry, across both levels ---------------------------------------

@pytest.mark.parametrize("node_type,body_field,extension", [
    ("code", "code", ".py"),
    ("ai", "system_prompt", ".md"),
    ("data", "data_format_prompt", ".md"),
])
def test_each_node_element_declares_what_it_authors(node_type, body_field, extension):
    _, item = _node(node_type)
    assert item is not None
    assert item.spec.body_field == body_field
    assert item.spec.extension == extension


@pytest.mark.parametrize("kind,body_field", [
    ("input_picker", "selector_code"),
    ("plot_window", "code"),
    ("image_view", "code"),
])
def test_each_widget_element_declares_what_it_authors(kind, body_field):
    _, item = _widget(kind)
    assert item is not None
    assert item.spec.body_field == body_field


@pytest.mark.parametrize("node_type", ["input", "output"])
def test_a_node_with_nothing_authored_has_no_file(node_type):
    _, item = _node(node_type)
    assert item is None


def test_a_widget_with_nothing_authored_has_no_file():
    _, item = _widget("text_io")
    assert item is None


@pytest.mark.parametrize("make,body,prompt_text", [
    (lambda: _node("code", code_prompt="Die Absicht."), "def run(i):\n    return {}", "Die Absicht."),
    (lambda: _node("ai", description="Die Absicht."), "You are careful.", "Die Absicht."),
    (lambda: _node("data", data_prompt="Die Absicht."), "ts: ISO-8601", "Die Absicht."),
    (lambda: _widget("plot_window", code_prompt="Die Absicht."), "def run(i):\n    return {}", "Die Absicht."),
    (lambda: _widget("input_picker", selector_prompt="Die Absicht."), "def run(i):\n    return {}", "Die Absicht."),
])
def test_everything_round_trips_through_the_same_code(make, body, prompt_text):
    """Nodes and widgets alike: render, parse, apply, unchanged."""
    _, item = make()
    item.body = body
    name = node_files.default_file_name(item.label, item.spec.extension)

    header, parsed = node_files.parse(node_files.render(item, name), name)
    node_files.apply(item, header, parsed)

    assert item.body == body
    assert item.prompt == prompt_text
    assert header["id"] == item.ident


# --- names ------------------------------------------------------------------

def test_the_file_is_named_after_the_element():
    assert node_files.default_file_name("Analyse", ".py") == "Analyse.py"
    assert node_files.default_file_name("Analyse", ".md") == "Analyse.md"


def test_a_label_a_filesystem_would_reject_still_yields_a_name():
    assert node_files.default_file_name("Werte / 2024: roh?", ".py") == "Werte_2024_roh.py"
    assert node_files.default_file_name("***", ".py") == "node.py"


def test_two_elements_with_the_same_label_do_not_collide():
    assert node_files.default_file_name("Analyse", ".py", {"Analyse.py"}) == "Analyse_2.py"


# --- the header per file kind ----------------------------------------------

def test_a_python_file_fences_the_header_in_comments():
    _, item = _node("code", code="def run(inputs):\n    return {}", code_prompt="Zaehle die Woerter.")
    text = node_files.render(item, "Analyse.py")

    assert text.startswith("# --- ai-graph ---")
    assert "# node:    Analyse" in text
    assert "#   Zaehle die Woerter." in text
    assert "# inputs:  text" in text
    assert text.rstrip().endswith("return {}")


def test_a_javascript_widget_uses_javascript_comments():
    _, item = _widget("plot_window", language="javascript", code="function run(i){return {}}")
    text = node_files.render(item, "Verlauf.js")
    assert text.startswith("// --- ai-graph ---")
    assert "// node:    Verlauf" in text


def test_a_markdown_file_uses_front_matter_because_hash_is_a_heading():
    _, item = _node("ai", system_prompt="You are careful.", description="Sei vorsichtig.")
    text = node_files.render(item, "Assistent.md")

    assert text.startswith("---\n")
    assert "node:    Analyse" in text
    assert "#" not in text.split("\n\n")[0]
    assert text.rstrip().endswith("You are careful.")


def test_a_widget_header_states_the_ports_the_graph_wires_to():
    _, item = _widget("plot_window")
    text = node_files.render(item, "Verlauf.py")
    assert "# inputs:  w1_in" in text
    assert "# outputs: w1_out" in text


# --- what is allowed back ---------------------------------------------------

def test_authored_fields_flow_back():
    _, item = _node("code", code="alt", code_prompt="alt")
    header, body = node_files.parse(
        "# --- ai-graph ---------\n"
        "# node:    Neuer Name\n"
        "# id:      code-1\n"
        "# prompt: |\n"
        "#   Ein neuer Prompt\n"
        "# context-file: neu.csv\n"
        "# ------------------------\n"
        "\ndef run(inputs):\n    return 1\n",
        "Analyse.py",
    )
    node_files.apply(item, header, body)

    assert item.label == "Neuer Name"
    assert item.prompt == "Ein neuer Prompt"
    assert item.body == "def run(inputs):\n    return 1"


def test_ports_in_the_header_are_read_only():
    """A text file renaming a port would silently break every edge into it."""
    node, item = _node("code")
    header, body = node_files.parse(
        "# --- ai-graph ---------\n# node: Analyse\n# id: code-1\n"
        "# inputs:  etwas_ganz_anderes\n# outputs: auch_anders\n# ---------------\n"
        "\ndef run(inputs):\n    return 1\n",
        "Analyse.py",
    )
    node_files.apply(item, header, body)

    assert [p.id for p in node.inputs] == ["text"]
    assert [p.id for p in node.outputs] == ["result"]


def test_the_id_is_never_applied():
    node, item = _node("code")
    header, body = node_files.parse(
        "# --- ai-graph ---\n# node: Analyse\n# id: eine-andere-id\n# ---------------\n\ndef run(i):\n    return 1\n",
        "Analyse.py",
    )
    node_files.apply(item, header, body)
    assert node.id == "code-1"


def test_a_hand_written_file_without_a_header_is_all_body():
    """Being lenient is what lets a person write one of these from scratch."""
    header, body = node_files.parse("def run(inputs):\n    return 1\n", "Analyse.py")
    assert header == {}
    assert body == "def run(inputs):\n    return 1"


def test_an_empty_code_file_is_written_as_its_skeleton():
    """An empty .py told a reader nothing the header had not already said.

    The stub states the signature the body has to fill in, one line per port --
    written, never read back, exactly like the `inputs:`/`outputs:` header lines.
    """
    node = GraphNode(
        id="n1", node_type=NodeType.CODE, label="Analyse",
        inputs=[Port(id="text", name="Text", kind=PortKind.INPUT)],
        outputs=[Port(id="summary", name="Summary", kind=PortKind.OUTPUT)],
        config=NodeConfig(code=""),
    )
    spec = NODE_ELEMENTS[NodeType.CODE].authored_file(node)
    rendered = node_files.render(node_files.for_node(node, spec), "Analyse.py")

    assert "def run(inputs: Inputs) -> dict:" in rendered
    assert '"summary": ...' in rendered
    # Still parseable as a header plus a body, and the body is the stub.
    header, body = node_files.parse(rendered, "Analyse.py")
    assert header["node"] == "Analyse"
    assert "def run" in body


def test_a_written_body_is_never_replaced_by_the_skeleton():
    node = GraphNode(
        id="n1", node_type=NodeType.CODE, label="Analyse",
        inputs=[Port(id="text", name="Text", kind=PortKind.INPUT)],
        outputs=[Port(id="summary", name="Summary", kind=PortKind.OUTPUT)],
        config=NodeConfig(code="def run(inputs):\n    return {'summary': 'x'}\n"),
    )
    spec = NODE_ELEMENTS[NodeType.CODE].authored_file(node)
    rendered = node_files.render(node_files.for_node(node, spec), "Analyse.py")
    assert "TypedDict" not in rendered
    assert "'summary': 'x'" in rendered


def test_a_prose_body_gets_no_skeleton():
    """An ai node's file is a system prompt; a Python stub in it is nonsense."""
    node = GraphNode(
        id="n2", node_type=NodeType.AI, label="Ask", description="ask things",
        config=NodeConfig(system_prompt=""),
    )
    spec = NODE_ELEMENTS[NodeType.AI].authored_file(node)
    rendered = node_files.render(node_files.for_node(node, spec), "Ask.md")
    assert "def run" not in rendered
