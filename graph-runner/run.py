#!/usr/bin/env python3
"""
AI-Graph Runner – execute a graph JSON file from the command line.

Usage:
    python run.py graph.json [--inputs key=value ...]
    python run.py graph.json --json-inputs '{"key": "value"}'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# Allow running from the repo root
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

try:
    from app.models.graph import Graph
    from app.services.graph_executor import execute_graph
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

    # Inject extra inputs into text_input nodes whose value is unset
    if extra_inputs:
        for node in graph.nodes:
            if node.node_type == "text_input" and node.id in extra_inputs:
                node.config.value = extra_inputs[node.id]

    print(f"Executing graph: {graph.metadata.name!r}", file=sys.stderr)
    result = await execute_graph(graph)

    output = result.model_dump()
    print(json.dumps(output, indent=2, default=str))

    if result.status == "error":
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Execute an AI-Graph JSON file",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("graph", help="Path to the graph JSON file")
    parser.add_argument(
        "--inputs",
        nargs="*",
        metavar="key=value",
        default=[],
        help="Override text_input node values (by node ID)",
    )
    parser.add_argument(
        "--json-inputs",
        type=str,
        default=None,
        help="Override inputs as a JSON object",
    )
    args = parser.parse_args()

    extra: dict = {}
    if args.json_inputs:
        extra = json.loads(args.json_inputs)
    if args.inputs:
        extra.update(parse_kv(args.inputs))

    asyncio.run(run(args.graph, extra))


if __name__ == "__main__":
    main()
