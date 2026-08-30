"""
The stub a code element starts from, and that a generator is asked to complete.

A generator used to be told `Inputs: text, files` -- names with no type, no
shape and no origin. Everything below is about the difference between that and a
signature.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import skeleton  # noqa: E402


def test_without_a_sample_it_is_still_the_signature():
    """No run yet: types are unknown, but the shape of the answer is not."""
    rendered = skeleton.render("python", ["text"], ["summary"])
    assert "class Inputs(TypedDict):" in rendered
    assert "text: Any" in rendered
    assert "def run(inputs: Inputs) -> dict:" in rendered
    assert '"summary": ...' in rendered


def test_observed_values_become_types():
    rendered = skeleton.render(
        "python", ["text", "count", "rows"], ["out"],
        sample={"text": "hi", "count": 3, "rows": [{"a": 1}]},
    )
    assert "text: str" in rendered
    assert "count: int" in rendered
    assert "rows: list[dict]" in rendered


def test_a_bool_is_not_reported_as_an_int():
    """`isinstance(True, int)` is true in Python; the annotation must not be."""
    assert "flag: bool" in skeleton.render("python", ["flag"], ["out"], sample={"flag": True})


def test_a_fan_in_port_shows_the_list_it_really_is():
    """"The input is the previous element's output" holds only for one source.

    A port fed by several edges arrives as a list, and code written for a scalar
    breaks on exactly the graphs that are worth building.
    """
    rendered = skeleton.render(
        "python", ["files"], ["out"],
        sample={"files": ["/a.md", "/b.md"]},
        sources={"files": 'Ordner" + "Uploads'},
    )
    assert "files: list[str]" in rendered
    assert "Ordner" in rendered and "Uploads" in rendered


def test_provenance_is_shown_because_no_type_can_express_it():
    rendered = skeleton.render("python", ["text"], ["out"], sources={"text": "Reader"})
    assert 'from "Reader"' in rendered


def test_a_long_sample_value_is_truncated():
    """A directory listing must not become the skeleton."""
    rendered = skeleton.render("python", ["blob"], ["out"], sample={"blob": "x" * 500})
    assert "…" in rendered
    assert len(rendered) < 400


def test_javascript_gets_a_jsdoc_typedef_not_a_typeddict():
    rendered = skeleton.render(
        "javascript", ["text", "n"], ["out"], sample={"text": "hi", "n": 2},
    )
    assert "@typedef {Object} Inputs" in rendered
    assert "@property {string} text" in rendered
    assert "@property {number} n" in rendered
    assert "function run(inputs) {" in rendered
    assert "TypedDict" not in rendered


def test_a_port_id_that_is_not_an_identifier_still_produces_valid_code():
    """Widget ports are `<widgetId>_in`, and widget ids carry dashes."""
    rendered = skeleton.render("python", ["widget-1-99_in"], ["widget-1-99_out"])
    compile(rendered, "<skeleton>", "exec")


def test_the_rendered_python_always_compiles():
    for sample in (None, {"a": [1, 2]}, {"a": None}):
        rendered = skeleton.render("python", ["a"], ["b"], sample=sample)
        compile(rendered, "<skeleton>", "exec")


def test_an_element_with_no_ports_still_gets_a_runnable_stub():
    rendered = skeleton.render("python", [], [])
    assert "def run(inputs: dict) -> dict:" in rendered
    assert "return {}" in rendered
    compile(rendered, "<skeleton>", "exec")
