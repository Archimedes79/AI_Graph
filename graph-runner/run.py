#!/usr/bin/env python3
"""
AI-Graph Runner – execute a graph JSON file from the command line.

Usage:
    python run.py graph.json [--inputs key=value ...]
    python run.py graph.json --json-inputs '{"key": "value"}'
    python run.py                                  # defaults to ./graph.json

This file is also copied verbatim into every deploy bundle as its `main.py`
(see `backend/app/services/deploy_service.py`) -- a deployed bundle runs the
exact same code as this CLI, just with `app/` vendored alongside it instead of
imported from `../backend`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# Allow running from the repo root during development. This is a no-op when
# this file is copied verbatim into a deploy bundle as main.py: there is no
# sibling "backend" directory there, and Python already puts this script's
# own directory (containing the bundle's vendored `app` package) on sys.path.
_dev_backend_dir = Path(__file__).parent.parent / "backend"
if _dev_backend_dir.is_dir():
    sys.path.insert(0, str(_dev_backend_dir))


def _default_graph_path() -> Path:
    """
    Where to look for the graph when no path was given on the command line.

    Normally just `graph.json` in the current working directory. In a
    PyInstaller one-file build (see the bundle's `build_exe.py`) the graph is
    embedded as a data file and unpacked to `sys._MEIPASS` at startup, so that
    copy is used instead -- but a `graph.json` placed next to the executable
    still wins, so a shipped tool can be re-pointed at a different graph
    without rebuilding it.
    """
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        beside_exe = Path(sys.executable).parent / "graph.json"
        if beside_exe.is_file():
            return beside_exe
        return Path(bundled) / "graph.json"
    return Path("graph.json")

try:
    from app.models.graph import Graph
    from app.services import ai_settings
    from app.services.graph_executor import (
        apply_runtime_values,
        execute_graph,
        get_runtime_requirements,
        get_text_output_windows,
    )
except ImportError as exc:
    print(f"Error: Could not import backend modules. {exc}", file=sys.stderr)
    print(
        "Make sure you have installed backend/requirements.txt and are running "
        "from the repository root.",
        file=sys.stderr,
    )
    sys.exit(1)

logging.basicConfig(level=logging.WARNING, format="%(levelname)s: %(message)s")


def parse_kv(pairs: list[str]) -> dict:
    """Parse key=value pairs into a dict."""
    result = {}
    for pair in pairs:
        if "=" not in pair:
            raise ValueError(f"Invalid key=value pair: {pair!r}")
        k, _, v = pair.partition("=")
        result[k.strip()] = v
    return result


async def run(graph_path: str, extra_inputs: dict) -> None:
    path = Path(graph_path)
    if not path.exists():
        print(f"Error: Graph file not found: {graph_path}", file=sys.stderr)
        sys.exit(1)

    graph = Graph.model_validate_json(path.read_text(encoding="utf-8"))

    # execute_graph() publishes this itself, but do it here too so the banner
    # below reports the AI this run will actually use rather than the bare
    # fallback -- the graph's own default is the last thing still missing at
    # this point (CLI flags and env vars were already in place).
    ai_defaults = graph.metadata.ai_defaults
    ai_settings.set_graph_defaults(
        str(getattr(ai_defaults.provider, "value", ai_defaults.provider) or ""),
        ai_defaults.model,
    )

    # Inject explicit CLI overrides into any node's config.value (by node ID)
    if extra_inputs:
        for node in graph.nodes:
            if node.id in extra_inputs:
                node.config.value = extra_inputs[node.id]

    # Prompt interactively for any remaining values the graph needs
    resolved: dict = {}
    for req in get_runtime_requirements(graph):
        key = f"{req.node_id}::{req.widget_id}" if req.widget_id else req.node_id
        if key in extra_inputs:
            continue
        if req.kind == "text":
            prompt_label = f"Text for '{req.label}'"
        else:
            verb = "Read" if req.direction == "input" else "Write"
            prompt_label = f"{verb} {req.kind} for '{req.label}'"
        default = req.current_value
        suffix = f" [{default}]" if default else ""
        try:
            answer = input(f"{prompt_label}{suffix}: ").strip()
        except EOFError:
            if default:
                answer = default
            else:
                print(
                    f"Error: Missing runtime value for {req.kind} node '{req.label}' and no interactive stdin is available.",
                    file=sys.stderr,
                )
                sys.exit(1)
        resolved[key] = answer or default
    apply_runtime_values(graph, resolved)

    ai = ai_settings.describe()
    forced = " [forced for every node]" if ai["force"] else ""
    where = ai["settings_file"] if ai["settings_file_exists"] else f"{ai['settings_file']} (not present)"
    print(
        f"Executing graph: {graph.metadata.name!r}\n"
        f"  AI default: {ai['provider']} / {ai['model']}{forced}\n"
        f"  AI settings file: {where}",
        file=sys.stderr,
    )
    result = await execute_graph(graph)

    output = result.model_dump()
    print(json.dumps(output, indent=2, default=str))

    for window in get_text_output_windows(graph, result):
        border = "=" * 60
        print(f"\n{border}\n📄 TEXT OUTPUT: {window['label']}\n{border}", file=sys.stderr)
        print(window["content"], file=sys.stderr)
        print(border, file=sys.stderr)

    if result.status == "error":
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Execute an AI-Graph JSON file",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "graph", nargs="?", default=None,
        help="Path to the graph JSON file (default: graph.json next to this script/executable)",
    )
    parser.add_argument(
        "--inputs",
        nargs="*",
        metavar="key=value",
        default=[],
        help="Override any node's value by node ID (input text, file/directory paths, output paths)",
    )
    parser.add_argument(
        "--json-inputs",
        type=str,
        default=None,
        help="Override inputs as a JSON object",
    )
    # Configure the AI once, for this run, instead of per node. Nodes left at
    # the `default` provider follow this; --ai-force also overrides nodes that
    # pin a provider of their own. Without these flags the same setting can
    # come from AI_GRAPH_AI_PROVIDER/AI_GRAPH_AI_MODEL, from an
    # ai-settings.json next to this script/executable, or from the graph's own
    # metadata.ai_defaults -- see app/services/ai_settings.py.
    parser.add_argument(
        "--ai-provider", default="", metavar="NAME",
        help="AI provider for this run: ollama | lmstudio | openai | anthropic | "
             "openai_compatible | github_copilot",
    )
    parser.add_argument(
        "--ai-model", default="", metavar="MODEL",
        help="Model name for this run (e.g. llama3, qwen2.5-coder-7b, gpt-4o)",
    )
    parser.add_argument(
        "--ai-force", action="store_true",
        help="Also override AI nodes that pin their own provider",
    )
    args = parser.parse_args()

    ai_settings.set_override(args.ai_provider, args.ai_model, args.ai_force)

    extra: dict = {}
    if args.json_inputs:
        extra = json.loads(args.json_inputs)
    if args.inputs:
        extra.update(parse_kv(args.inputs))

    asyncio.run(run(args.graph or str(_default_graph_path()), extra))


if __name__ == "__main__":
    main()
