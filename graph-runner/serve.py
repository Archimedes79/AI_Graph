#!/usr/bin/env python3
"""
Local web front-end for a deployed graph.

    python serve.py                 # start, then open the browser
    python serve.py --port 8123
    python serve.py --no-browser
    python serve.py --host 0.0.0.0  # reachable from other machines (Docker)

This is the GUI counterpart of `main.py`: same graph, same vendored engine,
but the graph's `gui` nodes are rendered as real widgets in a browser page
instead of being reduced to console prompts. The page it serves is the AI-Graph
editor's own runtime view (`runtime.html`, built from
frontend/src/runtime/RuntimeApp.tsx), so every widget looks and behaves exactly
as it did in the designer -- there is no second widget implementation to drift.

Like `main.py`, this file is copied verbatim into a deploy bundle by
deploy_service.py; only bundles that actually contain GUI nodes get it, next to
the built page in `static/`.

Endpoints, deliberately the minimum the runtime page calls:

    GET  /                      the runtime page
    GET  /api/runtime/graph     the graph this tool ships
    POST /api/execute/          run it
    POST /api/execute/requirements   what it still needs before running
    POST /api/execute/start     run it in the background, watchably
    GET  /api/execute/runs/{id}      progress, then the result
    POST /api/execute/runs/{id}/cancel   stop it
    GET  /api/runtime/ai-settings    the AI it will call
    POST /api/runtime/ai-settings    point it somewhere else, persistently
    POST /api/files/browse      list a directory, for the file/directory pickers
                                (loopback binds only -- see create_app)

The editor's own routers are NOT vendored (they are a build/authoring surface,
and a deployed tool must not offer code generation or graph editing); these few
handlers call the vendored services directly instead.
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Any, Dict, List

HERE = Path(__file__).resolve().parent

# Dev-only shim, identical to main.py's: a no-op inside a bundle, where `app/`
# already sits next to this file.
_dev_backend_dir = HERE.parent / "backend"
if _dev_backend_dir.is_dir():
    sys.path.insert(0, str(_dev_backend_dir))
sys.path.insert(0, str(HERE))

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles
    import uvicorn
except ImportError:  # pragma: no cover - a headless bundle simply has no serve.py
    print(
        "The web runtime needs fastapi and uvicorn:\n"
        "    pip install -r requirements.txt\n"
        "Or run the command-line version instead:  python main.py",
        file=sys.stderr,
    )
    raise SystemExit(1)

from app.models.graph import ExecutionResult, Graph, RuntimeRequirement  # noqa: E402
from app.services import ai_settings, file_service  # noqa: E402
from app.services import run_registry  # noqa: E402
from app.services.graph_executor import execute_graph, get_runtime_requirements  # noqa: E402

# `_default_graph_path` lives in the runner entry point, which is called run.py
# in this repository and main.py inside a bundle -- the same file under two
# names, so try both rather than duplicating the resolution logic here.
try:
    from main import _default_graph_path  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - repository checkout
    from run import _default_graph_path  # type: ignore[attr-defined]

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai-graph-runtime")

STATIC_DIR = HERE / "static"


def load_graph(graph_path: Path) -> Graph:
    if not graph_path.is_file():
        raise SystemExit(f"Graph file not found: {graph_path}")
    return Graph.model_validate_json(graph_path.read_text(encoding="utf-8"))


def _publish_graph_ai_defaults(graph: Graph) -> None:
    """Mirror of main.py: make the graph's own AI default visible to the
    resolver, so /api/runtime/ai-settings can report what will actually be
    called before anything has run."""
    defaults = graph.metadata.ai_defaults
    ai_settings.set_graph_defaults(
        str(getattr(defaults.provider, "value", defaults.provider) or ""),
        defaults.model,
    )


# Which settings key holds the endpoint for a provider, for the runtime
# settings panel's single "Server address" field.
_ENDPOINT_KEYS = {
    "ollama": "ollama_base_url",
    "lmstudio": "lmstudio_base_url",
    "openai_compatible": "openai_compatible_base_url",
}
_KEY_KEYS = {
    "openai": "openai",
    "anthropic": "anthropic",
    "openai_compatible": "openai_compatible",
    "github_copilot": "github",
}


def _is_loopback(host: str) -> bool:
    """Whether this bind address only reaches the machine the tool runs on."""
    return host in ("127.0.0.1", "localhost", "::1")


def create_app(graph_path: Path, allow_browse: bool = True) -> "FastAPI":
    app = FastAPI(title="AI-Graph Runtime", docs_url=None, redoc_url=None)

    # A deployed tool still must not offer code generation, and it exposes no
    # graph editing. File BROWSING is different: a graph whose interface is "pick
    # a file and process it" is unusable without it, because a browser never
    # reveals a chosen file's real path and the engine resolves real paths. It is
    # limited to a loopback bind -- on `--host 0.0.0.0` this would hand the
    # machine's filesystem listing to the network, which is a different thing
    # entirely from letting the person at the keyboard pick their own file.
    if allow_browse:
        @app.post("/api/files/browse")
        async def browse(payload: Dict[str, Any]) -> Dict[str, Any]:
            try:
                return file_service.browse_directory(
                    payload.get("path") or "",
                    file_service.parse_extensions_filter(payload.get("extensions") or ""),
                )
            except FileNotFoundError as exc:
                raise HTTPException(404, str(exc)) from exc
            except PermissionError as exc:
                raise HTTPException(403, f"Not permitted to read that directory: {exc}") from exc
            except OSError as exc:
                raise HTTPException(400, str(exc)) from exc

    @app.get("/api/runtime/graph")
    async def runtime_graph() -> Graph:
        graph = load_graph(graph_path)
        _publish_graph_ai_defaults(graph)
        return graph

    @app.post("/api/execute/")
    async def run(graph: Graph) -> ExecutionResult:
        return await execute_graph(graph)

    @app.post("/api/execute/requirements")
    async def requirements(graph: Graph) -> List[RuntimeRequirement]:
        return get_runtime_requirements(graph)

    # The runtime page runs graphs through these so a deployed tool has the same
    # progress display and Stop button the editor has -- the alternative is a
    # spinner whose only exit is closing the window.
    @app.post("/api/execute/start")
    async def start_run(graph: Graph) -> Dict[str, Any]:
        run = run_registry.start(graph)
        return {"run_id": run.id, "total": run.total}

    @app.get("/api/execute/runs/{run_id}")
    async def get_run(run_id: str) -> Dict[str, Any]:
        run = run_registry.get(run_id)
        if run is None:
            raise HTTPException(404, f"No run '{run_id}'")
        snapshot = run.snapshot()
        if run.cancelled and snapshot["result"] is None:
            snapshot["result"] = run_registry.cancelled_result().model_dump()
        return snapshot

    @app.post("/api/execute/runs/{run_id}/cancel")
    async def cancel_run(run_id: str) -> Dict[str, Any]:
        return {"cancelled": run_registry.cancel(run_id)}

    @app.get("/api/runtime/ai-settings")
    async def read_ai_settings() -> Dict[str, Any]:
        _publish_graph_ai_defaults(load_graph(graph_path))
        settings = ai_settings.settings()
        effective = ai_settings.describe()
        provider = str(settings.get("ai", {}).get("provider") or effective["provider"])
        endpoints = settings.get("endpoints", {}) or {}
        keys = settings.get("api_keys", {}) or {}
        return {
            "settings": settings,
            "effective": effective,
            "base_url": str(endpoints.get(_ENDPOINT_KEYS.get(provider, ""), "") or ""),
            "api_key": str(keys.get(_KEY_KEYS.get(provider, ""), "") or ""),
        }

    @app.post("/api/runtime/ai-settings")
    async def write_ai_settings(body: Dict[str, Any]) -> Dict[str, Any]:
        provider = str(body.get("provider") or "").strip()
        model = str(body.get("model") or "").strip()
        base_url = str(body.get("base_url") or "").strip()
        api_key = str(body.get("api_key") or "").strip()

        # Merge into whatever is already on disk rather than replacing it, so a
        # key configured for one provider survives switching to another and back.
        settings = dict(ai_settings.settings())
        settings["ai"] = {**settings.get("ai", {}), "provider": provider, "model": model}
        if provider in _ENDPOINT_KEYS:
            settings["endpoints"] = {**settings.get("endpoints", {}), _ENDPOINT_KEYS[provider]: base_url}
        if provider in _KEY_KEYS and api_key:
            settings["api_keys"] = {**settings.get("api_keys", {}), _KEY_KEYS[provider]: api_key}

        try:
            path = ai_settings.save(settings)
        except OSError as exc:
            raise HTTPException(500, f"Could not write the settings file: {exc}") from exc

        _publish_graph_ai_defaults(load_graph(graph_path))
        return {"path": str(path), "effective": ai_settings.describe()}

    if STATIC_DIR.is_dir():
        @app.get("/")
        async def index() -> FileResponse:
            # The runtime view, not the editor's index.html -- a deployed tool
            # is the graph, not the canvas that built it.
            return FileResponse(STATIC_DIR / "runtime.html")

        app.mount("/", StaticFiles(directory=str(STATIC_DIR)), name="static")
    else:
        @app.get("/")
        async def missing_static() -> Dict[str, str]:
            return {"error": "No static/ directory in this bundle; run `python main.py` instead."}

    return app


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("graph", nargs="?", default=None, help="Path to the graph JSON (default: the bundled graph.json)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1, this machine only)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser window on start")
    parser.add_argument("--ai-provider", default="", metavar="NAME", help="AI provider for this run")
    parser.add_argument("--ai-model", default="", metavar="MODEL", help="Model for this run")
    parser.add_argument("--ai-force", action="store_true", help="Also override AI nodes that pin their own provider")
    args = parser.parse_args()

    ai_settings.set_override(args.ai_provider, args.ai_model, args.ai_force)

    graph_path = Path(args.graph) if args.graph else _default_graph_path()
    graph = load_graph(graph_path)
    _publish_graph_ai_defaults(graph)

    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host}:{args.port}/"
    logger.info("%s -> %s", graph.metadata.name, url)
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    allow_browse = _is_loopback(args.host)
    if not allow_browse:
        logger.info("Bound to %s, not loopback: the file picker's browse endpoint is disabled.", args.host)
    app = create_app(graph_path, allow_browse=allow_browse)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
