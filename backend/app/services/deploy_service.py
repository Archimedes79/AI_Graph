"""
Deployment service.

Compiles a Graph into a single, self-contained Python script: the graph's
nodes are unrolled into straight-line code in topological order, with each
node's config (paths, prompts, code, separators, ...) baked in as literals.
The generated script does NOT depend on the AI-Graph backend package or a
graph.json file at runtime — it only needs the Python standard library plus
`httpx` when the graph contains an AI node.
"""

from __future__ import annotations

import textwrap
from typing import Dict, List, Tuple

from app.elements.base import DeployNeeds
from app.elements.registry import NODE_ELEMENTS
from app.models.graph import Graph, GraphNode, NodeType
from app.services import ai_service, batching, code_executor, file_service
from app.services.deploy.shared import DEFERRED_EMPTY, DEFERRED_LITERAL, extract_source

# ---------------------------------------------------------------------------
# Compile-time graph analysis
# ---------------------------------------------------------------------------

def _topological_order(graph: Graph) -> List[GraphNode]:
    """
    Return nodes sorted so every node appears after its upstream dependencies.
    Deferred (t+1) edges carry a previous-round value and impose no ordering,
    so a graph that is acyclic without them can still be compiled.
    """
    node_map = {n.id: n for n in graph.nodes}
    in_degree = {n.id: 0 for n in graph.nodes}
    successors: Dict[str, List[str]] = {n.id: [] for n in graph.nodes}
    for edge in graph.edges:
        if edge.deferred:
            continue
        if edge.source_node_id in node_map and edge.target_node_id in node_map:
            in_degree[edge.target_node_id] += 1
            successors[edge.source_node_id].append(edge.target_node_id)

    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    order: List[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for succ in successors[nid]:
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(order) != len(node_map):
        raise ValueError("Graph contains a cycle; it cannot be compiled.")
    return [node_map[nid] for nid in order]


def _sources_by_target(graph: Graph) -> Dict[Tuple[str, str], List[Tuple[str, str]]]:
    """
    Map (target_node_id, target_port_id) -> ordered [(source_node_id, source_port_id), ...].

    A deferred (t+1) edge has no current-round producer -- the compiled script runs
    exactly one round -- so it is recorded with a sentinel source node id instead:
    its literal initial value, or a marker contributing no value at all.
    """
    mapping: Dict[Tuple[str, str], List[Tuple[str, str]]] = {}
    for edge in graph.edges:
        key = (edge.target_node_id, edge.target_port_id)
        if edge.deferred:
            source = (
                (DEFERRED_LITERAL, repr(edge.initial_value))
                if edge.initial_value is not None
                else (DEFERRED_EMPTY, "")
            )
        else:
            source = (edge.source_node_id, edge.source_port_id)
        mapping.setdefault(key, []).append(source)
    return mapping


def _requirements_literal(graph: Graph) -> List[dict]:
    """
    The list of {node_id, label, kind, direction, current_value[, widget_id]} the
    compiled script must prompt for -- built from the exact same per-element
    `runtime_requirements` the live editor's `graph_executor.get_runtime_requirements`
    calls, so the two can never diverge on which nodes/widgets prompt at runtime.
    """
    reqs: List[dict] = []
    for node in graph.nodes:
        element = NODE_ELEMENTS.get(node.node_type)
        if element is not None:
            reqs.extend(element.runtime_requirements(node))
    return reqs


# ---------------------------------------------------------------------------
# Self-contained runtime helper snippets (embedded verbatim, no app.* imports)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Self-contained runtime helper snippets. Each block below embeds the REAL
# portable functions from the corresponding live-execution service module
# verbatim, via extract_source() (see deploy/shared.py) reading their actual
# source text at compile time -- never a hand-copied second version that
# merely resembles the real implementation -- plus a little glue (aliases,
# batch orchestration) that has no live-side counterpart to duplicate. A fix
# to file_service.py / batching.py / code_executor.py / ai_service.py is
# therefore picked up here automatically; the deployed bundle can never
# silently drift from live execution.
# ---------------------------------------------------------------------------

_FILE_HELPERS = "\n\n\n".join([
    "import base64, csv, io, logging, mimetypes",
    "logger = logging.getLogger(__name__)",
    extract_source(file_service, [
        "resolve_path",
        "list_directory",
        "_normalize_extensions",
        "read_text_file",
        "read_binary_file_base64",
        "serialize_text_value",
        "_is_binary_format",
        "_binary_extension",
        "write_text_file",
        "write_formatted_file",
        "write_output_directory",
    ]),
])

# `_resolve_file_inputs`/`_read_one_file` have no portable single-source
# counterpart to embed: they mirror graph_executor.py's `_resolve_file_inputs`/
# `_read_one` (app/services/graph_executor.py, ~lines 218-247), which operate on
# GraphNode/Port objects rather than plain dicts and so aren't directly
# portable. Left hand-copied for now -- small, self-contained, and outside
# this task's 4 named unification domains -- but they do call the real
# `read_text_file`/`read_binary_file_base64` embedded above instead of
# redefining their own copies.
_READ_FILE_INPUTS_HELPER = '''\
def _read_one_file(path, fmt):
    normalized = (fmt or "").lower()
    if normalized.startswith("image/") or normalized in ("binary", "application/octet-stream"):
        return read_binary_file_base64(path)
    return read_text_file(path)


def _resolve_file_inputs(inputs, file_ports):
    resolved = {}
    for key, value in inputs.items():
        fmt = file_ports.get(key) if key in file_ports else None
        if key not in file_ports:
            resolved[key] = value
        elif isinstance(value, list):
            resolved[key] = [_read_one_file(item, fmt) if item is not None else None for item in value]
        elif value is None:
            resolved[key] = None
        else:
            resolved[key] = _read_one_file(value, fmt)
    return resolved
'''

_BATCH_HELPERS = extract_source(batching, ["batch_items", "merge_batch_results", "reconcile_outputs_by_ids"])

# Mirrors `batching.reconcile_outputs`'s warn callback with a stderr message
# instead of a log line (the deploy script has no logger configured for it);
# the actual matching/wrapping logic lives once, in `reconcile_outputs_by_ids`
# above. Duplicated verbatim into both _CODE_RUNNER_HELPER and _AI_HELPER
# (rather than a third shared block) since each is embedded independently and
# neither always accompanies the other.
_RECONCILE_GLUE = '''\
def _reconcile_outputs(output_port_ids, result):
    def _warn(keys, port_ids):
        print(
            f"\\u26a0\\ufe0f  Output keys {keys} match none of the declared "
            f"output ports {port_ids}; values may be dropped downstream.",
            file=sys.stderr,
        )
    return reconcile_outputs_by_ids(output_port_ids, result, warn=_warn)
'''

_CODE_RUNNER_HELPER = "\n\n\n".join([
    "import logging, subprocess, textwrap",
    "logger = logging.getLogger(__name__)",
    extract_source(code_executor, [
        "EXECUTION_TIMEOUT",
        "_SUBPROCESS_ENV_ALLOWLIST",
        "_sandboxed_env",
        "_run_in_subprocess",
        "execute_python",
        "execute_javascript",
        "execute_code",
    ]),
    _RECONCILE_GLUE,
    textwrap.dedent('''\
        async def _run_code_batch(code, language, inputs, output_port_ids=None,
                                   multi_port_ids=(), input_multi_port_ids=()):
            items = batch_items(inputs, input_multi_port_ids)
            results = []
            for item in items:
                result = await execute_code(code, language, item)
                results.append(_reconcile_outputs(output_port_ids, result))
            return merge_batch_results(results, multi_port_ids)
        '''),
])

_AI_HELPER = "\n\n\n".join([
    "import logging",
    "import httpx",
    "logger = logging.getLogger(__name__)",
    extract_source(ai_service, [
        "OLLAMA_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LMSTUDIO_BASE_URL",
        "OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY",
        "_ollama_complete", "_openai_complete", "_anthropic_complete",
        "_lmstudio_complete", "_openai_compatible_complete", "complete",
    ]),
    _RECONCILE_GLUE,
    textwrap.dedent('''\
        async def _ai_complete_batch(inputs, system, model, temperature, provider,
                                      output_port_ids=None, multi_port_ids=(),
                                      input_multi_port_ids=()):
            items = batch_items(inputs, input_multi_port_ids)
            prompts = ["\\n\\n".join(str(value) for value in item.values() if value is not None) for item in items]
            responses = await asyncio.gather(*(
                complete(prompt, system, model, temperature, provider)
                for prompt in prompts
            ))
            return merge_batch_results(
                [_reconcile_outputs(output_port_ids, {"output": response}) for response in responses],
                multi_port_ids,
            )
        '''),
])


# ---------------------------------------------------------------------------
# Script generation
# ---------------------------------------------------------------------------

def generate_runner_script(graph: Graph) -> str:
    """
    Compile *graph* into a single, self-contained, executable Python script.
    The graph's nodes are unrolled into straight-line code (elements + code),
    so the script needs neither graph.json nor the AI-Graph backend package.
    """
    order = _topological_order(graph)
    sources = _sources_by_target(graph)
    node_map = {n.id: n for n in graph.nodes}

    needs = DeployNeeds()
    for node in graph.nodes:
        element = NODE_ELEMENTS.get(node.node_type)
        if element is not None:
            needs = needs | element.deploy_needs(node)

    needs_files = needs.files or needs.read_file_inputs
    needs_code_runner = needs.code_runner
    needs_ai = needs.ai
    needs_read_file_inputs = needs.read_file_inputs

    imports = ["from __future__ import annotations", "import asyncio", "import json", "import sys"]
    if needs_files:
        imports.append("from pathlib import Path")
    if needs_code_runner:
        imports += ["import os", "import tempfile"]
    elif needs_ai:
        imports.append("import os")

    helper_blocks: List[str] = []
    if needs_files:
        helper_blocks.append(_FILE_HELPERS)
    if needs_read_file_inputs:
        helper_blocks.append(_READ_FILE_INPUTS_HELPER)
    if needs_code_runner or needs_ai:
        helper_blocks.append(_BATCH_HELPERS)
    if needs_code_runner:
        helper_blocks.append(_CODE_RUNNER_HELPER)
    if needs_ai:
        helper_blocks.append(_AI_HELPER)

    requirements = _requirements_literal(graph)

    body_lines: List[str] = []
    for node in order:
        body_lines.append("try:")
        element = NODE_ELEMENTS.get(node.node_type)
        if element is None:
            raise ValueError(f"Unknown node type: {node.node_type}")
        compiled_lines = [f"# Node: {node.label} ({node.node_type.value})", *element.compile(node, sources, node_map)]
        for line in compiled_lines:
            body_lines.append("    " + line)
        body_lines.append("except Exception as _exc:")
        body_lines.append(f"    print(f\"\\u274c Error executing '{node.label}': {{_exc}}\", file=sys.stderr)")
        body_lines.append(f"    results[{node.id!r}] = {{}}")
        body_lines.append("")

    body = textwrap.indent("\n".join(body_lines), "    ")

    final_output_lines = []
    for node in graph.nodes:
        if node.node_type in (NodeType.OUTPUT, NodeType.TEXT_OUTPUT):
            label = node.config.output_label or node.id
            final_output_lines.append(f"    final_outputs[{label!r}] = results.get({node.id!r}, {{}})")
    final_outputs_code = "\n".join(final_output_lines) or "    pass"

    header_lines = [
        "#!/usr/bin/env python3",
        '"""',
        f"Compiled, self-contained runner for graph: {graph.metadata.name}",
        "Generated by AI-Graph. This script does not need graph.json or the",
        "AI-Graph backend to run \u2014 every node's logic is baked in below.",
        '"""',
        *imports,
        "",
    ]

    main_lines = [
        "",
        f"_REQUIREMENTS = {requirements!r}",
        "",
        "",
        "async def main():",
        "    _resolved = {}",
        "    for req in _REQUIREMENTS:",
        '        _req_key = f\'{req["node_id"]}::{req["widget_id"]}\' if req.get("widget_id") else req["node_id"]',
        '        if req["kind"] == "text":',
        '            prompt_label = f"Text for \'{req[\'label\']}\'"',
        "        else:",
        '            verb = "Read" if req["direction"] == "input" else "Write"',
        '            prompt_label = f"{verb} {req[\'kind\']} for \'{req[\'label\']}\'"',
        '        default = req["current_value"]',
        '        suffix = f" [{default}]" if default else ""',
        '        answer = input(f"{prompt_label}{suffix}: ").strip()',
        '        _resolved[_req_key] = answer or default',
        "",
        "    results = {}",
        "    _text_windows = []",
        "",
        body,
        "    final_outputs = {}",
        final_outputs_code,
        "    print(json.dumps(final_outputs, indent=2, default=str))",
        "",
        "    for window in _text_windows:",
        '        border = "=" * 60',
        '        print(f"\\n{border}\\n\\U0001f4c4 TEXT OUTPUT: {window[\'label\']}\\n{border}", file=sys.stderr)',
        '        print(window["content"], file=sys.stderr)',
        '        print(border, file=sys.stderr)',
        "",
        "",
        'if __name__ == "__main__":',
        "    asyncio.run(main())",
        "",
    ]

    sections = ["\n".join(header_lines)]
    if helper_blocks:
        sections.append("\n\n".join(helper_blocks))
    sections.append("\n".join(main_lines))
    return "\n\n".join(sections)


def _needs_httpx(graph: Graph) -> bool:
    return any(n.node_type == NodeType.AI for n in graph.nodes)


def _bundle_requirements_txt(graph: Graph) -> str:
    """pip requirements for the standalone run_graph.py (httpx only if it calls an AI node)."""
    return "httpx\n" if _needs_httpx(graph) else "# No third-party dependencies required.\n"


def _bundle_dockerfile() -> str:
    return textwrap.dedent(
        """\
        FROM python:3.11-slim
        WORKDIR /app
        COPY requirements.txt .
        RUN pip install --no-cache-dir -r requirements.txt
        COPY run_graph.py .
        CMD ["python", "run_graph.py"]
        """
    )


def _bundle_readme(graph: Graph) -> str:
    return textwrap.dedent(
        f"""\
        # {graph.metadata.name} — deployment bundle

        Self-contained runner generated by AI-Graph. `run_graph.py` has every node's
        logic baked in as literals; it needs neither `graph.json` nor the AI-Graph
        backend package to run.

        ## Run directly with Python
            python -m venv .venv
            . .venv/bin/activate          # Windows: .venv\\Scripts\\activate
            pip install -r requirements.txt
            python run_graph.py

        ## Run with Docker Compose
            docker compose up --build

        Set AI-provider credentials via environment variables as needed:
        `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LMSTUDIO_BASE_URL`.
        """
    )


def generate_docker_compose(graph: Graph, image_tag: str = "ai-graph-runner:latest") -> str:
    """Return a docker-compose.yml string for running the compiled graph script."""
    name = graph.metadata.name.lower().replace(" ", "-")

    compose = textwrap.dedent(
        f"""\
        version: "3.9"

        services:
          {name}-runner:
            build: .
            image: {image_tag}
            environment:
              - OLLAMA_BASE_URL=${{OLLAMA_BASE_URL:-http://ollama:11434}}
              - OPENAI_API_KEY=${{OPENAI_API_KEY:-}}
              - ANTHROPIC_API_KEY=${{ANTHROPIC_API_KEY:-}}
            volumes:
              - ./data:/data
            command: >
              python /app/run_graph.py

          ollama:
            image: ollama/ollama:latest
            ports:
              - "11434:11434"
            volumes:
              - ollama_data:/root/.ollama

        volumes:
          ollama_data:
        """
    )
    return compose


def generate_deployment_bundle(graph: Graph) -> dict[str, str]:
    """
    Return a dict of {filename: content} for a full, ready-to-run deployment bundle:
      - run_graph.py       – compiled, self-contained executable
      - requirements.txt   – pip deps (httpx only if the graph uses an AI node)
      - Dockerfile         – builds an image that runs run_graph.py
      - docker-compose.yml – builds via the Dockerfile above and runs it
      - README.md          – run instructions (plain Python and Docker)
    The graph definition itself is not needed at runtime, so it is not included.
    """
    return {
        "run_graph.py": generate_runner_script(graph),
        "requirements.txt": _bundle_requirements_txt(graph),
        "Dockerfile": _bundle_dockerfile(),
        "docker-compose.yml": generate_docker_compose(graph),
        "README.md": _bundle_readme(graph),
    }
