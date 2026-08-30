"""
Every graph in `examples/` loads, validates, and runs.

Examples are the first thing anyone opens and the easiest thing to break: they
are data, so no compiler or type checker touches them, and a renamed port or a
retired field shows up as a broken demo rather than a failing build. This file
runs them.

The AI is stubbed. What is being checked is the graph -- that its ports line up,
that its batching does what its description claims, that its files exist -- not
that a language model says anything in particular.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import ExecutionStatus, Graph  # noqa: E402
from app.services import ai_service  # noqa: E402
from app.services.graph_executor import execute_graph  # noqa: E402

REPO_ROOT = Path(__file__).parent.parent.parent
EXAMPLES = REPO_ROOT / "examples"

# Examples whose input paths are relative to the repository root, as a user
# running them from a checkout would have them.
_EXAMPLE_FILES = sorted(EXAMPLES.glob("*.json"))


@pytest.fixture
def at_repo_root(monkeypatch):
    """Run from the repo root, so `examples/...` in a graph resolves."""
    monkeypatch.chdir(REPO_ROOT)


@pytest.fixture
def stub_ai(monkeypatch):
    """Every AI call answers with something short and identifiable."""
    calls: list[dict] = []

    async def complete(prompt, system="", model="", temperature=0.7, provider="default", **kwargs):
        calls.append({"prompt": prompt, "system": system})
        return f"ZUSAMMENFASSUNG {len(calls)}"

    monkeypatch.setattr(ai_service, "complete", complete)
    return calls


@pytest.mark.parametrize("path", _EXAMPLE_FILES, ids=lambda p: p.stem)
def test_every_example_is_a_valid_graph(path: Path):
    """Validation covers the migrations too: an example written before a rename
    must still load, or it is not an example any more."""
    graph = Graph.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert graph.nodes, f"{path.name} has no nodes"

    node_ids = {node.id for node in graph.nodes}
    for edge in graph.edges:
        assert edge.source_node_id in node_ids, f"{path.name}: edge {edge.id} has no source"
        assert edge.target_node_id in node_ids, f"{path.name}: edge {edge.id} has no target"
        source = next(n for n in graph.nodes if n.id == edge.source_node_id)
        target = next(n for n in graph.nodes if n.id == edge.target_node_id)
        assert any(p.id == edge.source_port_id for p in source.outputs), (
            f"{path.name}: edge {edge.id} leaves {source.id} through a port it does not have"
        )
        assert any(p.id == edge.target_port_id for p in target.inputs), (
            f"{path.name}: edge {edge.id} enters {target.id} through a port it does not have"
        )


@pytest.mark.parametrize("path", _EXAMPLE_FILES, ids=lambda p: p.stem)
def test_every_referenced_file_exists(path: Path, at_repo_root):
    """A demo pointing at a file nobody shipped is the commonest way an example
    breaks, and the least visible: it fails only when someone runs it."""
    graph = Graph.model_validate(json.loads(path.read_text(encoding="utf-8")))
    for node in graph.nodes:
        value = node.config.value
        if node.node_type.value == "input" and isinstance(value, str) and value:
            if node.config.input_mode != "text":
                assert Path(value).exists(), f"{path.name}: {node.label} points at missing {value}"
        # Widgets carry paths too, and checking only nodes is how an example
        # pointing at `e:\test\data.csv` survived in this folder.
        for widget in node.config.gui_widgets:
            if widget.kind.value != "input_picker":
                continue
            picked = widget.value
            if isinstance(picked, str) and picked:
                assert Path(picked).exists(), (
                    f"{path.name}: widget {widget.label or widget.id} points at missing {picked}"
                )


@pytest.mark.parametrize("path", _EXAMPLE_FILES, ids=lambda p: p.stem)
def test_no_example_ships_the_default_passthrough_as_its_point(path: Path):
    """A code node still holding `return {"output": inputs["input"]}` is an
    unfinished machine save, not an example -- the previous plotter shipped one
    and therefore fed a file *path* into its chart.
    """
    graph = Graph.model_validate(json.loads(path.read_text(encoding="utf-8")))
    for node in graph.nodes:
        if node.node_type.value != "code":
            continue
        body = (node.config.code or "").replace(" ", "").replace("\n", "")
        assert body != 'defrun(inputs):return{"output":inputs.get("input","")}', (
            f"{path.name}: code node {node.label} is still the empty default"
        )


@pytest.mark.parametrize("path", _EXAMPLE_FILES, ids=lambda p: p.stem)
def test_every_example_says_what_it_is(path: Path):
    """"Untitled Graph" with an empty description is a save, not an example."""
    graph = Graph.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert graph.metadata.name and graph.metadata.name != "Untitled Graph", path.name
    assert graph.metadata.description.strip(), f"{path.name} has no description"


async def test_the_plotter_turns_the_csv_into_points(at_repo_root):
    """The plotter needs no AI and no network, so it runs here exactly as it
    runs for a user."""
    graph = Graph.model_validate(json.loads((EXAMPLES / "plotter.json").read_text(encoding="utf-8")))
    result = await execute_graph(graph)

    assert result.status == ExecutionStatus.SUCCESS, result.error
    points = next(r for r in result.node_results if r.node_id == "points").outputs["points"]
    assert len(points) == 5
    assert [p["label"] for p in points] == ["Indien", "China", "USA", "Indonesien", "Pakistan"]
    # Scaled to millions and sorted largest first -- what the node's prompt says.
    assert points[0]["value"] == 1430.0
    assert points == sorted(points, key=lambda p: p["value"], reverse=True)


async def test_the_plotter_feeds_the_chart_widget(at_repo_root):
    """The plot widget is display-only: its value arrives on its *input* port,
    which is where the runtime window reads it from."""
    graph = Graph.model_validate(json.loads((EXAMPLES / "plotter.json").read_text(encoding="utf-8")))
    result = await execute_graph(graph)

    chart = next(r for r in result.node_results if r.node_id == "chart")
    shown = chart.inputs["plot_in"]
    assert isinstance(shown, list) and shown[0]["label"] == "Indien"


async def test_the_summary_example_summarises_each_story_then_all_of_them(at_repo_root, stub_ai):
    """The point of this example is the two batch modes, so that is what is checked.

    `per_item` must call the model once per story; `whole_list` must call it once
    with every summary in one prompt.
    """
    graph = Graph.model_validate(json.loads((EXAMPLES / "text_summary.json").read_text(encoding="utf-8")))
    result = await execute_graph(graph)

    assert result.status == ExecutionStatus.SUCCESS, result.error
    stories = sorted((EXAMPLES / "kurzgeschichten").glob("*.txt"))
    assert len(stories) >= 3, "the example needs stories to summarise"

    # One call per story, plus exactly one for the overall pass.
    assert len(stub_ai) == len(stories) + 1

    per_story = next(r for r in result.node_results if r.node_id == "per_story")
    assert len(per_story.outputs["output"]) == len(stories)

    # read_file_inputs turned each path into the story's text before the call.
    assert "Leuchtturm" in "".join(call["prompt"] for call in stub_ai)
    assert not any(call["prompt"].endswith(".txt") for call in stub_ai)

    # The whole_list node saw every summary at once.
    overall_prompt = stub_ai[-1]["prompt"]
    assert overall_prompt.count("ZUSAMMENFASSUNG") == len(stories)


async def test_the_summary_example_delivers_both_levels_to_its_output(at_repo_root, stub_ai):
    graph = Graph.model_validate(json.loads((EXAMPLES / "text_summary.json").read_text(encoding="utf-8")))
    result = await execute_graph(graph)

    outputs = next(r for r in result.node_results if r.node_id == "result").outputs
    assert isinstance(outputs["einzeln"], list) and len(outputs["einzeln"]) >= 3
    assert isinstance(outputs["gesamt"], str)


async def test_the_interactive_plotter_charts_the_picked_file(at_repo_root):
    """The picker's stored value stands in for a click, so this runs headless too.

    It also covers `read_file_inputs`: the code node declares a `file_path` input
    and receives the file's *text*, without ever touching the filesystem itself.
    """
    graph = Graph.model_validate(
        json.loads((EXAMPLES / "plotter_interactive.json").read_text(encoding="utf-8"))
    )
    result = await execute_graph(graph)

    assert result.status == ExecutionStatus.SUCCESS, result.error
    points = next(r for r in result.node_results if r.node_id == "points").outputs["points"]
    assert [p["label"] for p in points][:2] == ["Indien", "China"]

    # The chart is display-only: its value lands on its own input port, which is
    # where the runtime window reads it from.
    panel = next(r for r in result.node_results if r.node_id == "panel")
    assert panel.inputs["chart_in"][0]["value"] == 1430.0
