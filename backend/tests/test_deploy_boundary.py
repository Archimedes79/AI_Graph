"""
The licence boundary, enforced.

A deploy bundle is handed to somebody else, so what it may contain is a closed
list: the vendored engine, the runner scripts, the runtime page, the user's own
graph, and `LICENSE-runtime`, which covers exactly those. Nothing from the
editor -- `app/routers/**`, `app/main.py`, `deploy_service.py` itself,
`node_files.py`, the designer's frontend -- may ever end up in one.

That rule is both architectural (a deployed tool must not offer code generation
or a file browser) and legal (the editor and the runtime are licensed
separately, so a bundle that carried an editor file would carry the editor's
terms into it). Both failures are silent: a bundle with an extra file in it
still runs, and still passes every other test in this suite. These tests are
the alarm.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.graph import (  # noqa: E402
    Graph, GraphMetadata, GraphNode, GuiWidget, GuiWidgetKind, NodeType,
    sync_gui_node_ports,
)
from app.services import deploy_service  # noqa: E402
from app.services.deploy_service import _PORTABLE_SERVICE_MODULES  # noqa: E402

REPO_ROOT = Path(__file__).parent.parent.parent
APP_ROOT = REPO_ROOT / "backend" / "app"

# Editor-only modules, named rather than derived: a test that computed this
# list from the same source deploy_service uses would agree with any mistake.
_EDITOR_ONLY = [
    "app/main.py",
    "app/services/deploy_service.py",
    "app/services/node_files.py",
    "app/services/code_refine.py",
]


def _headless_graph() -> Graph:
    return Graph(metadata=GraphMetadata(name="Boundary"))


def _gui_graph() -> Graph:
    gui = GraphNode(
        id="gui", node_type=NodeType.GUI, label="GUI",
        gui_widgets=[GuiWidget(id="w1", kind=GuiWidgetKind.TEXT_IO, label="Text")],
    )
    sync_gui_node_ports(gui)
    return Graph(metadata=GraphMetadata(name="Boundary GUI"), nodes=[gui], edges=[])


# --- python: only the portable engine ---------------------------------------

def test_no_editor_module_is_vendored():
    bundle = deploy_service.generate_deployment_bundle(_headless_graph())

    assert not any(path.startswith("app/routers/") for path in bundle)
    for path in _EDITOR_ONLY:
        assert path not in bundle, f"{path} is an editor module and must not ship"


def test_the_vendored_services_are_exactly_the_declared_portable_set():
    """`_PORTABLE_SERVICE_MODULES` is the whitelist. A module added to
    `app/services/` must be listed there deliberately to travel -- never by
    virtue of sitting in the directory."""
    bundle = deploy_service.generate_deployment_bundle(_headless_graph())

    shipped = {
        path.removeprefix("app/services/")
        for path in bundle
        if path.startswith("app/services/")
    }
    assert shipped == set(_PORTABLE_SERVICE_MODULES)


def test_every_vendored_python_file_is_its_repo_file_verbatim():
    """Vendoring means copying, not generating. If this ever fails, a bundle
    has started to hold a second authored copy of some behaviour."""
    bundle = deploy_service.generate_deployment_bundle(_headless_graph())

    for path, content in bundle.items():
        if not path.startswith("app/"):
            continue
        source = APP_ROOT / path.removeprefix("app/")
        assert source.is_file(), f"{path} has no repo file behind it"
        assert content == source.read_text(encoding="utf-8"), f"{path} is not verbatim"


# --- the licence ------------------------------------------------------------

def test_a_bundle_carries_the_runtime_licence_not_the_editors():
    """
    The bundle's terms come from `LICENSE-runtime`, the file that covers the
    files a bundle contains. Both licence files currently hold the same text,
    so today this test only pins down *which file is read* -- which is the
    whole point: the day the terms diverge, this is what stops the editor's
    licence from being shipped to somebody who never received the editor.
    """
    runtime_licence = REPO_ROOT / "LICENSE-runtime"
    assert runtime_licence.is_file(), "LICENSE-runtime is what a bundle ships under"

    bundle = deploy_service.generate_deployment_bundle(_headless_graph())
    assert bundle["LICENSE"] == runtime_licence.read_text(encoding="utf-8")


# --- the frontend: the runtime entry point, and what it reaches -------------

def test_only_the_runtime_half_of_the_build_is_vendored(tmp_path, monkeypatch):
    """One Vite build holds both entry points. A bundle gets `runtime.html` and
    the closure of what it references -- not `index.html`, and not the editor's
    own chunk, even though both sit in the same directory."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "runtime.html").write_text('<script src="/assets/runtime.js"></script>', encoding="utf-8")
    (dist / "index.html").write_text('<script src="/assets/editor.js"></script>', encoding="utf-8")
    (dist / "assets" / "runtime.js").write_text("import './shared.js'", encoding="utf-8")
    (dist / "assets" / "editor.js").write_text("import './shared.js'", encoding="utf-8")
    (dist / "assets" / "shared.js").write_text("export const widgets = {}", encoding="utf-8")
    monkeypatch.setattr(deploy_service, "_FRONTEND_DIST", dist)

    bundle = deploy_service.generate_deployment_bundle(_gui_graph())
    static = {path for path in bundle if path.startswith("static/")}

    assert static == {
        "static/runtime.html",
        "static/assets/runtime.js",
        "static/assets/shared.js",
    }


@pytest.mark.skipif(
    not (Path(__file__).parent.parent.parent / "frontend" / "dist" / "runtime.html").is_file(),
    reason="needs a real `npm run build` output",
)
def test_the_real_built_editor_page_never_reaches_a_bundle():
    """The same claim against the actual build, whose chunk names are hashed
    and therefore cannot be asserted literally: whatever `index.html` loads,
    a bundle does not carry it."""
    dist = REPO_ROOT / "frontend" / "dist"
    bundle = deploy_service.generate_deployment_bundle(_gui_graph())

    assert "static/index.html" not in bundle
    assert "static/runtime.html" in bundle

    editor_page = (dist / "index.html").read_text(encoding="utf-8")
    runtime_page = (dist / "runtime.html").read_text(encoding="utf-8")
    editor_only = [
        path.relative_to(dist).as_posix()
        for path in sorted((dist / "assets").rglob("*"))
        if path.is_file() and path.name in editor_page and path.name not in runtime_page
    ]
    assert editor_only, "fixture check: the editor page should load a chunk of its own"
    for rel in editor_only:
        assert f"static/{rel}" not in bundle, f"{rel} belongs to the editor page"
