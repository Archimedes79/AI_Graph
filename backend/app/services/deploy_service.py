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

from app.models.graph import Graph, GraphNode, NodeType

# ---------------------------------------------------------------------------
# Compile-time graph analysis
# ---------------------------------------------------------------------------

def _topological_order(graph: Graph) -> List[GraphNode]:
    """Return nodes sorted so every node appears after its upstream dependencies."""
    node_map = {n.id: n for n in graph.nodes}
    in_degree = {n.id: 0 for n in graph.nodes}
    successors: Dict[str, List[str]] = {n.id: [] for n in graph.nodes}
    for edge in graph.edges:
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
    """Map (target_node_id, target_port_id) -> ordered [(source_node_id, source_port_id), ...]."""
    mapping: Dict[Tuple[str, str], List[Tuple[str, str]]] = {}
    for edge in graph.edges:
        key = (edge.target_node_id, edge.target_port_id)
        mapping.setdefault(key, []).append((edge.source_node_id, edge.source_port_id))
    return mapping


def _collect_inputs_lines(node: GraphNode, sources: Dict[Tuple[str, str], List[Tuple[str, str]]]) -> List[str]:
    """Generate the lines that build `_inputs` for *node* from upstream results."""
    lines = ["_inputs = {}"]
    for port in node.inputs:
        srcs = sources.get((node.id, port.id), [])
        if not srcs:
            continue
        if len(srcs) == 1:
            sid, sport = srcs[0]
            lines.append(f"_inputs[{port.id!r}] = results[{sid!r}][{sport!r}]")
        else:
            items = ", ".join(f"results[{sid!r}][{sport!r}]" for sid, sport in srcs)
            lines.append(f"_inputs[{port.id!r}] = [{items}]")
    return lines


def _flatten_values_lines(inputs_var: str, out_var: str) -> List[str]:
    """Lines that flatten a dict-of-values (lists expand, scalars stringify) into a list of strings."""
    return [
        f"{out_var} = []",
        f"for _v in {inputs_var}.values():",
        "    if isinstance(_v, list):",
        f"        {out_var}.extend(str(x) for x in _v)",
        "    elif _v is not None:",
        f"        {out_var}.append(str(_v))",
    ]


def _node_lines(node: GraphNode, sources: Dict[Tuple[str, str], List[Tuple[str, str]]]) -> List[str]:
    """Generate the executable lines for a single node. Assumes `results` and `_resolved` exist."""
    cfg = node.config
    nt = node.node_type
    lines: List[str] = [f"# Node: {node.label} ({nt.value})"]

    if nt == NodeType.TEXT_INPUT:
        lines.append(f"results[{node.id!r}] = {{'output': _resolved.get({node.id!r}, {(cfg.value or '')!r})}}")

    elif nt == NodeType.FILE_INPUT:
        lines.append(f"_path = _resolved.get({node.id!r}, {(cfg.value or '')!r})")
        lines.append(f"results[{node.id!r}] = {{'content': _read_text_file(_path), 'path': _path}}")

    elif nt == NodeType.DIRECTORY_INPUT:
        recursive = bool(cfg.extra.get("recursive", False))
        lines.append(f"_path = _resolved.get({node.id!r}, {(cfg.value or '')!r})")
        lines.append(f"_files = _list_directory(_path, recursive={recursive!r})")
        if not cfg.select_all_files and cfg.selector_code.strip():
            lines.append(
                f"_files = (await _run_code({cfg.selector_code!r}, {(cfg.language or 'python')!r}, "
                f"{{'files': _files}})).get('files', _files)"
            )
        lines.append(f"results[{node.id!r}] = {{'files': _files, 'count': len(_files)}}")

    elif nt == NodeType.AI:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.append("_prompt = '\\n\\n'.join(str(v) for v in _inputs.values() if v is not None)")
        lines.append(
            "_output = await _ai_complete(_prompt, "
            f"system={cfg.system_prompt!r}, model={cfg.ai_model!r}, "
            f"temperature={cfg.temperature!r}, provider={cfg.ai_provider.value!r})"
        )
        lines.append(f"results[{node.id!r}] = {{'output': _output}}")

    elif nt == NodeType.CODE:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.append(f"results[{node.id!r}] = await _run_code({cfg.code!r}, {(cfg.language or 'python')!r}, _inputs)")

    elif nt == NodeType.OUTPUT:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.append(f"results[{node.id!r}] = dict(_inputs)")
        if cfg.write_mode in ("file", "directory"):
            lines.append(f"_out_path = _resolved.get({node.id!r}, {(cfg.value or '')!r})")
            lines.append("if _out_path:")
            if cfg.write_mode == "file":
                lines.append("    _content = '\\n'.join(str(v) for v in _inputs.values() if v is not None)")
                lines.append(f"    results[{node.id!r}]['written_path'] = _write_text_file(_out_path, _content)")
            else:
                lines.append(f"    results[{node.id!r}]['written_paths'] = _write_output_directory(_out_path, _inputs)")

    elif nt == NodeType.TEXT_OUTPUT:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.append(f"results[{node.id!r}] = dict(_inputs)")
        lines.extend(_flatten_values_lines("_inputs", "_parts"))
        label = cfg.output_label or node.label
        lines.append(f"_text_windows.append({{'label': {label!r}, 'content': chr(10).join(_parts)}})")

    elif nt == NodeType.MERGE:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.extend(_flatten_values_lines("_inputs", "_parts"))
        lines.append(f"results[{node.id!r}] = {{'output': {cfg.separator!r}.join(_parts)}}")

    elif nt == NodeType.SPLIT:
        lines.extend(_collect_inputs_lines(node, sources))
        lines.append("_source = next(iter(_inputs.values()), '')")
        lines.append(f"_items = str(_source).split({cfg.separator!r}) if _source else []")
        lines.append(f"results[{node.id!r}] = {{'items': _items, 'count': len(_items)}}")

    else:
        raise ValueError(f"Unknown node type: {nt}")

    return lines


def _requirements_literal(graph: Graph) -> List[dict]:
    """The list of {node_id, label, kind, direction, current_value} the compiled script must prompt for."""
    reqs: List[dict] = []
    for node in graph.nodes:
        cfg = node.config
        if node.node_type == NodeType.TEXT_INPUT:
            reqs.append({"node_id": node.id, "label": node.label, "kind": "text", "direction": "input", "current_value": cfg.value or ""})
        elif node.node_type == NodeType.FILE_INPUT:
            reqs.append({"node_id": node.id, "label": node.label, "kind": "file", "direction": "input", "current_value": cfg.value or ""})
        elif node.node_type == NodeType.DIRECTORY_INPUT:
            reqs.append({"node_id": node.id, "label": node.label, "kind": "directory", "direction": "input", "current_value": cfg.value or ""})
        elif node.node_type == NodeType.OUTPUT and cfg.prompt_at_runtime and cfg.write_mode != "none":
            reqs.append({"node_id": node.id, "label": node.label, "kind": cfg.write_mode, "direction": "output", "current_value": cfg.value or ""})
    return reqs


# ---------------------------------------------------------------------------
# Self-contained runtime helper snippets (embedded verbatim, no app.* imports)
# ---------------------------------------------------------------------------

_FILE_HELPERS = '''\
def _read_text_file(path):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return p.read_text(encoding="utf-8", errors="replace")


def _list_directory(path, recursive=False):
    root = Path(path)
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {path}")
    if recursive:
        return [str(p) for p in root.rglob("*") if p.is_file()]
    return [str(p) for p in root.iterdir() if p.is_file()]


def _write_text_file(path, content):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return str(p)


def _write_output_directory(dir_path, values):
    root = Path(dir_path)
    root.mkdir(parents=True, exist_ok=True)
    written = []
    index = 0
    for port_id, value in values.items():
        items = value if isinstance(value, list) else [value]
        for item in items:
            if item is None:
                continue
            name = f"{port_id}_{index}.txt" if len(items) > 1 or len(values) > 1 else f"{port_id}.txt"
            out_path = root / name
            out_path.write_text(str(item), encoding="utf-8")
            written.append(str(out_path))
            index += 1
    return written
'''

_CODE_RUNNER_HELPER = '''\
async def _run_code(code, language, inputs):
    lang = language.lower()
    if lang in ("python", "py"):
        wrapper = f"""
import json, sys
{code}
_inputs = json.loads(sys.argv[1])
print(json.dumps(run(_inputs)))
"""
        cmd = [sys.executable]
        suffix = ".py"
    elif lang in ("javascript", "js", "node"):
        wrapper = f"""
{code}
const _inputs = JSON.parse(process.argv[2]);
console.log(JSON.stringify(run(_inputs)));
"""
        cmd = ["node"]
        suffix = ".js"
    else:
        raise ValueError(f"Unsupported code language: {language}")

    with tempfile.NamedTemporaryFile(mode="w", suffix=suffix, delete=False, encoding="utf-8") as f:
        f.write(wrapper)
        tmp_path = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, tmp_path, json.dumps(inputs),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip())
        raw = stdout.decode().strip()
        return json.loads(raw) if raw else {}
    finally:
        os.unlink(tmp_path)
'''

_AI_HELPER = '''\
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LMSTUDIO_BASE_URL = os.getenv("LMSTUDIO_BASE_URL", "http://localhost:1234/v1")


async def _ai_complete(prompt, system, model, temperature, provider, timeout=120.0):
    import httpx

    if provider == "ollama":
        payload = {"model": model, "prompt": prompt, "system": system, "stream": False,
                   "options": {"temperature": temperature}}
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
            r.raise_for_status()
            return r.json().get("response", "")

    if provider in ("openai", "anthropic", "lmstudio"):
        messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
        if provider == "openai":
            if not OPENAI_API_KEY:
                raise ValueError("OPENAI_API_KEY environment variable not set")
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json={"model": model, "messages": messages, "temperature": temperature},
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
        if provider == "anthropic":
            if not ANTHROPIC_API_KEY:
                raise ValueError("ANTHROPIC_API_KEY environment variable not set")
            payload = {"model": model, "max_tokens": 4096, "temperature": temperature,
                       "messages": [{"role": "user", "content": prompt}]}
            if system:
                payload["system"] = system
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.post(
                    "https://api.anthropic.com/v1/messages", json=payload,
                    headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01"},
                )
                r.raise_for_status()
                return r.json()["content"][0]["text"]
        # lmstudio
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{LMSTUDIO_BASE_URL}/chat/completions",
                json={"model": model, "messages": messages, "temperature": temperature},
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    raise ValueError(f"Unknown AI provider: {provider}")
'''


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
    node_types = {n.node_type for n in graph.nodes}

    needs_files = bool(node_types & {NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT, NodeType.OUTPUT})
    needs_code_runner = bool(node_types & {NodeType.CODE}) or any(
        n.node_type == NodeType.DIRECTORY_INPUT and not n.config.select_all_files and n.config.selector_code.strip()
        for n in graph.nodes
    )
    needs_ai = NodeType.AI in node_types

    imports = ["import asyncio", "import json", "import sys"]
    if needs_files:
        imports.append("from pathlib import Path")
    if needs_code_runner:
        imports += ["import os", "import tempfile"]
    elif needs_ai:
        imports.append("import os")

    helper_blocks: List[str] = []
    if needs_files:
        helper_blocks.append(_FILE_HELPERS)
    if needs_code_runner:
        helper_blocks.append(_CODE_RUNNER_HELPER)
    if needs_ai:
        helper_blocks.append(_AI_HELPER)

    requirements = _requirements_literal(graph)

    body_lines: List[str] = []
    for node in order:
        body_lines.append("try:")
        for line in _node_lines(node, sources):
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
        '        if req["kind"] == "text":',
        '            prompt_label = f"Text for \'{req[\'label\']}\'"',
        "        else:",
        '            verb = "Read" if req["direction"] == "input" else "Write"',
        '            prompt_label = f"{verb} {req[\'kind\']} for \'{req[\'label\']}\'"',
        '        default = req["current_value"]',
        '        suffix = f" [{default}]" if default else ""',
        '        answer = input(f"{prompt_label}{suffix}: ").strip()',
        '        _resolved[req["node_id"]] = answer or default',
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


def generate_docker_compose(graph: Graph, image_tag: str = "ai-graph-runner:latest") -> str:
    """Return a docker-compose.yml string for running the compiled graph script."""
    name = graph.metadata.name.lower().replace(" ", "-")

    compose = textwrap.dedent(
        f"""\
        version: "3.9"

        services:
          {name}-runner:
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
    Return a dict of {filename: content} for a full deployment bundle:
      - run_graph.py     – compiled, self-contained executable
      - docker-compose.yml
    The graph definition itself is not needed at runtime, so it is not included.
    """
    return {
        "run_graph.py": generate_runner_script(graph),
        "docker-compose.yml": generate_docker_compose(graph),
    }
