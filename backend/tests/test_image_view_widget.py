"""
The image_view widget: a server-side path becomes something a browser can render.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.elements.gui.widgets.image_view import image_view_element  # noqa: E402
from app.models.graph import GuiWidget, GuiWidgetKind  # noqa: E402
from app.services import file_service  # noqa: E402

# Smallest valid PNG: 1x1, transparent.
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _widget() -> GuiWidget:
    return GuiWidget(id="img", kind=GuiWidgetKind.IMAGE_VIEW)


async def test_path_becomes_a_data_url(tmp_path):
    target = tmp_path / "pixel.png"
    target.write_bytes(_PNG)

    shown = await image_view_element.ImageViewElement().display_value(_widget(), str(target))

    assert shown.startswith("data:image/png;base64,")
    assert base64.b64decode(shown.split(",", 1)[1]) == _PNG


async def test_a_list_of_paths_becomes_a_list_of_images(tmp_path):
    """A directory picker wired straight in should show every file, not the first."""
    paths = []
    for name in ("a.png", "b.png"):
        p = tmp_path / name
        p.write_bytes(_PNG)
        paths.append(str(p))

    shown = await image_view_element.ImageViewElement().display_value(_widget(), paths)

    assert len(shown) == 2
    assert all(s.startswith("data:image/png;base64,") for s in shown)


async def test_urls_pass_through_untouched():
    element = ImageViewElement = image_view_element.ImageViewElement()
    assert await element.display_value(_widget(), "https://example.com/a.png") == "https://example.com/a.png"
    assert await element.display_value(_widget(), "data:image/png;base64,AAAA") == "data:image/png;base64,AAAA"


async def test_a_missing_file_is_shown_not_raised(tmp_path):
    """Display failures are cosmetic -- they must not take the gui node down."""
    shown = await image_view_element.ImageViewElement().display_value(_widget(), str(tmp_path / "nope.png"))
    assert shown.startswith("⚠")


async def test_an_oversized_image_is_refused(tmp_path, monkeypatch):
    # The limit lives with the conversion, in file_service, shared with the ai node.
    monkeypatch.setattr(file_service, "MAX_INLINE_IMAGE_BYTES", 10)
    target = tmp_path / "big.png"
    target.write_bytes(_PNG)

    shown = await image_view_element.ImageViewElement().display_value(_widget(), str(target))
    assert "the limit is" in shown


async def test_a_non_image_is_refused(tmp_path):
    target = tmp_path / "notes.txt"
    target.write_text("hello", encoding="utf-8")

    shown = await image_view_element.ImageViewElement().display_value(_widget(), str(target))
    assert "Not a recognised image file" in shown
