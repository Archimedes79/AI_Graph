"""
Vision: an image input reaches the model as an image, not as a path in the prompt.

Four providers share the OpenAI content-parts format (LM Studio serving a vision
model speaks exactly what OpenAI does), Anthropic and Ollama each want their own
shape -- so the interesting assertions are about the request that gets built.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.registry import NODE_ELEMENTS  # noqa: E402
from app.models.graph import Graph, NodeType  # noqa: E402
from app.services import ai_service  # noqa: E402

_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _ai_node(send_images: bool):
    graph = Graph.model_validate({
        "metadata": {"name": "vision"},
        "nodes": [{
            "id": "ai", "node_type": "ai", "label": "Describe",
            "position": {"x": 0, "y": 0},
            "inputs": [{"id": "image", "name": "Image", "kind": "input",
                        "data_type": "file_path", "multi": False, "required": False}],
            "outputs": [{"id": "output", "name": "Out", "kind": "output",
                         "data_type": "text", "multi": False, "required": False}],
            "config": {"system_prompt": "Describe it.", "send_images": send_images},
        }],
        "edges": [],
    })
    return graph.nodes[0]


# --- request shapes ---------------------------------------------------------

def test_openai_style_puts_text_and_image_in_one_content_list():
    content = ai_service._openai_user_content("what is this?", ["data:image/png;base64,AAA"])
    assert content == [
        {"type": "text", "text": "what is this?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
    ]


def test_without_images_the_message_is_the_plain_string_it_always_was():
    """A text-only request must be byte-identical to what it was before vision."""
    assert ai_service._openai_user_content("just text", None) == "just text"
    assert ai_service._openai_user_content("just text", []) == "just text"


def test_anthropic_splits_the_data_url_into_media_type_and_payload():
    content = ai_service._anthropic_user_content("caption", ["data:image/jpeg;base64,BBB"])
    assert content[0] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": "BBB"},
    }
    assert content[1] == {"type": "text", "text": "caption"}


def test_ollama_takes_bare_base64():
    assert ai_service._ollama_images(["data:image/png;base64,CCC"]) == ["CCC"]


# --- the node ---------------------------------------------------------------

async def test_an_image_path_is_sent_as_an_image_not_as_prompt_text(tmp_path, monkeypatch):
    picture = tmp_path / "cat.png"
    picture.write_bytes(_PNG)
    seen = {}

    async def fake_complete(prompt, system, model, temperature, provider, images=None):
        seen["prompt"] = prompt
        seen["images"] = images
        return "a cat"

    monkeypatch.setattr(ai_service, "complete", fake_complete)

    element = NODE_ELEMENTS[NodeType.AI]
    await element.execute(_ai_node(send_images=True), {"image": str(picture)})

    assert seen["images"] and seen["images"][0].startswith("data:image/png;base64,")
    # The path must NOT also be pasted into the prompt.
    assert str(picture) not in seen["prompt"]


async def test_a_list_reaches_the_prompt_as_paragraphs_not_as_a_repr(monkeypatch):
    """Three summaries wired into a node are three paragraphs, not `['a', 'b']`.

    `str(list)` put brackets, quotes and commas into the prompt and made the
    model read around Python's syntax to find the text. Found by running the
    summary example through both engines: the TypeScript one serialised the
    same list as JSON, and the two prompts differed by exactly the punctuation.
    """
    seen = {}

    async def fake_complete(prompt, system, model, temperature, provider, images=None):
        seen["prompt"] = prompt
        return "ok"

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    await NODE_ELEMENTS[NodeType.AI].execute(_ai_node(send_images=False), {"summaries": ["first", "second"]})

    assert seen["prompt"] == "first\n\nsecond"


async def test_several_images_all_travel(tmp_path, monkeypatch):
    """A directory picker wired straight in sends every file, not the first."""
    paths = []
    for name in ("a.png", "b.png"):
        p = tmp_path / name
        p.write_bytes(_PNG)
        paths.append(str(p))
    seen = {}

    async def fake_complete(prompt, system, model, temperature, provider, images=None):
        seen["images"] = images
        return "two cats"

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    await NODE_ELEMENTS[NodeType.AI].execute(_ai_node(send_images=True), {"image": paths})

    assert len(seen["images"]) == 2


async def test_with_the_toggle_off_an_image_stays_prompt_text(tmp_path, monkeypatch):
    picture = tmp_path / "cat.png"
    picture.write_bytes(_PNG)
    seen = {}

    async def fake_complete(prompt, system, model, temperature, provider, **kwargs):
        seen["prompt"] = prompt
        seen["images"] = kwargs.get("images")
        return "?"

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    await NODE_ELEMENTS[NodeType.AI].execute(_ai_node(send_images=False), {"image": str(picture)})

    assert seen["images"] is None
    assert str(picture) in seen["prompt"]


async def test_a_non_image_input_is_still_prompt_text(monkeypatch):
    """Turning the toggle on must not swallow ordinary text inputs."""
    seen = {}

    async def fake_complete(prompt, system, model, temperature, provider, **kwargs):
        seen["prompt"] = prompt
        seen["images"] = kwargs.get("images")
        return "ok"

    monkeypatch.setattr(ai_service, "complete", fake_complete)
    await NODE_ELEMENTS[NodeType.AI].execute(_ai_node(send_images=True), {"image": "just a sentence"})

    assert seen["images"] is None
    assert seen["prompt"] == "just a sentence"
