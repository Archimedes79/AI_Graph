"""
The stub a code element starts from, and that a generator is asked to complete.

A generator used to be told `Inputs: text, files` -- names with no type, no
shape and no origin. Everything below is about the difference between that and a
signature.

JavaScript, and only JavaScript: a code node runs in the interpreter that runs
the engine, so there is no second language to render for and no interpreter for
a recipient to install.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services import skeleton  # noqa: E402


def assert_parses(rendered: str) -> None:
    """The skeleton is handed to a person and to a model as real code.

    Neither can do anything with a stub that does not parse -- and a port id is
    not a JavaScript identifier, which is exactly where a naive renderer emits
    `const widget-1-99_in = ...` and nobody notices until a run fails.
    """
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(rendered)
        path = f.name
    try:
        done = subprocess.run(["node", "--check", path], capture_output=True, text=True)
        assert done.returncode == 0, f"skeleton does not parse:\n{rendered}\n{done.stderr}"
    finally:
        Path(path).unlink(missing_ok=True)


def test_without_a_sample_it_is_still_the_signature():
    """No run yet: types are unknown, but the shape of the answer is not."""
    rendered = skeleton.render(["text"], ["summary"])
    assert "@typedef {Object} Inputs" in rendered
    assert "@property {*} text" in rendered
    assert "function run(inputs) {" in rendered
    assert '"summary": null' in rendered


def test_observed_values_become_types():
    rendered = skeleton.render(
        ["text", "count", "rows"], ["out"],
        sample={"text": "hi", "count": 3, "rows": [{"a": 1}]},
    )
    assert "{string} text" in rendered
    assert "{number} count" in rendered
    assert "{Object[]} rows" in rendered


def test_a_bool_is_not_reported_as_a_number():
    """`isinstance(True, int)` is true in Python; the annotation must not be."""
    assert "{boolean} flag" in skeleton.render(["flag"], ["out"], sample={"flag": True})


def test_a_fan_in_port_shows_the_list_it_really_is():
    """"The input is the previous element's output" holds only for one source.

    A port fed by several edges arrives as a list, and code written for a scalar
    breaks on exactly the graphs that are worth building.
    """
    rendered = skeleton.render(
        ["files"], ["out"],
        sample={"files": ["/a.md", "/b.md"]},
        sources={"files": 'Ordner" + "Uploads'},
    )
    assert "{string[]} files" in rendered
    assert "Ordner" in rendered and "Uploads" in rendered


def test_provenance_is_shown_because_no_type_can_express_it():
    rendered = skeleton.render(["text"], ["out"], sources={"text": "Reader"})
    assert 'from "Reader"' in rendered


def test_a_long_sample_value_is_truncated():
    """A directory listing must not become the skeleton."""
    rendered = skeleton.render(["blob"], ["out"], sample={"blob": "x" * 500})
    assert "…" in rendered
    assert len(rendered) < 400


def test_a_port_id_that_is_not_an_identifier_still_produces_valid_code():
    """Widget ports are `<widgetId>_in`, and widget ids carry dashes."""
    rendered = skeleton.render(["widget-1-99_in"], ["widget-1-99_out"])
    # The binding is renamed; the lookup keeps the port's real id, because that
    # is the key the executor hands over.
    assert 'inputs["widget-1-99_in"]' in rendered
    assert_parses(rendered)


def test_the_rendered_javascript_always_parses():
    for sample in (None, {"a": [1, 2]}, {"a": None}):
        assert_parses(skeleton.render(["a"], ["b"], sample=sample))


def test_an_element_with_no_ports_still_gets_a_runnable_stub():
    rendered = skeleton.render([], [])
    assert "function run(inputs) {" in rendered
    assert "return {}" in rendered
    assert_parses(rendered)
