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

from app.models.graph import Graph, GraphNode, GuiWidgetKind, NodeType
from app.services.deploy.node_compilers import compile_node
from app.services.deploy.shared import DEFERRED_EMPTY, DEFERRED_LITERAL

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


_INPUT_NODE_KINDS = {
    NodeType.TEXT_INPUT: "text",
    NodeType.FILE_INPUT: "file",
    NodeType.DIRECTORY_INPUT: "directory",
}


def _requirements_literal(graph: Graph) -> List[dict]:
    """The list of {node_id, label, kind, direction, current_value[, widget_id]} the compiled script must prompt for."""
    reqs: List[dict] = []
    for node in graph.nodes:
        cfg = node.config
        kind = _INPUT_NODE_KINDS.get(node.node_type)
        if kind is not None:
            reqs.append({"node_id": node.id, "label": node.label, "kind": kind, "direction": "input", "current_value": cfg.value or ""})
        elif node.node_type == NodeType.OUTPUT and cfg.prompt_at_runtime and cfg.write_mode != "none":
            reqs.append({"node_id": node.id, "label": node.label, "kind": cfg.write_mode, "direction": "output", "current_value": cfg.value or ""})
        elif node.node_type == NodeType.GUI:
            for widget in cfg.gui_widgets:
                if widget.value:
                    continue
                if widget.kind == GuiWidgetKind.FILE_OPEN:
                    widget_kind = "file"
                elif widget.kind == GuiWidgetKind.DIRECTORY_OPEN:
                    widget_kind = "directory"
                else:
                    continue
                reqs.append({
                    "node_id": node.id, "label": widget.label or widget.id, "kind": widget_kind,
                    "direction": "input", "current_value": "", "widget_id": widget.id,
                })
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


def _list_directory(path, recursive=False, extensions=None):
    root = Path(path).expanduser().resolve()
    if not root.exists():
        raise FileNotFoundError(f"Directory not found: {path}")
    candidates = root.rglob("*") if recursive else root.iterdir()
    files = [p for p in candidates if p.is_file()]
    if extensions:
        allowed = {e if e.startswith('.') else f'.{e}' for e in extensions}
        files = [p for p in files if p.suffix.lower() in allowed]
    return [str(p) for p in files]


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

_READ_FILE_INPUTS_HELPER = '''\
def _read_binary_file_base64(path):
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    return base64.b64encode(p.read_bytes()).decode("ascii")


def _read_one_file(path, fmt):
    normalized = (fmt or "").lower()
    if normalized.startswith("image/") or normalized in ("binary", "application/octet-stream"):
        return _read_binary_file_base64(path)
    return _read_text_file(path)


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

_CODE_RUNNER_HELPER = '''\
_SUBPROCESS_ENV_ALLOWLIST = {
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
    "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL",
}


def _sandboxed_env():
    """Minimal environment for a code-node subprocess: no secrets inherited."""
    return {k: v for k, v in os.environ.items() if k.upper() in _SUBPROCESS_ENV_ALLOWLIST}


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
            env=_sandboxed_env(),
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(stderr.decode().strip())
        raw = stdout.decode().strip()
        return json.loads(raw) if raw else {}
    finally:
        os.unlink(tmp_path)


async def _run_code_batch(code, language, inputs, output_port_ids=None, multi_port_ids=()):
    items = _batch_items(inputs)
    results = []
    for item in items:
        result = await _run_code(code, language, item)
        results.append(_reconcile_outputs(output_port_ids, result))
    return _merge_batch_results(results, multi_port_ids)
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


async def _ai_complete_batch(inputs, system, model, temperature, provider,
                             output_port_ids=None, multi_port_ids=()):
    items = _batch_items(inputs)
    prompts = ["\\n\\n".join(str(value) for value in item.values() if value is not None) for item in items]
    responses = await asyncio.gather(*(
        _ai_complete(prompt, system, model, temperature, provider)
        for prompt in prompts
    ))
    return _merge_batch_results(
        [_reconcile_outputs(output_port_ids, {"output": response}) for response in responses],
        multi_port_ids,
    )
'''

_BATCH_HELPERS = '''\
def _batch_items(inputs):
    size = max((len(value) for value in inputs.values() if isinstance(value, list)), default=1)
    return [
        {key: value[index] if isinstance(value, list) and index < len(value) else value
         for key, value in inputs.items()}
        for index in range(size)
    ]


def _merge_batch_results(results, multi_port_ids=()):
    """Collect one result per batch item; a single-item batch on a non-multi
    output port keeps its scalar value instead of becoming a 1-element list."""
    merged = {}
    single = len(results) == 1
    for result in results:
        for key, value in result.items():
            is_multi = key in multi_port_ids
            if single and not is_multi:
                merged[key] = value
                continue
            target = merged.setdefault(key, [])
            if is_multi and isinstance(value, list):
                target.extend(value)
            else:
                target.append(value)
    return merged


def _reconcile_outputs(output_port_ids, result):
    """Wrap a raw code/AI result under the sole declared output port id when its
    keys match none of the declared ports; warn (without crashing) if there are
    several declared ports and none of the keys match."""
    if not result or not isinstance(result, dict) or not output_port_ids:
        return result
    port_ids = set(output_port_ids)
    if port_ids & result.keys():
        return result
    if len(output_port_ids) == 1:
        return {output_port_ids[0]: result}
    print(
        f"\\u26a0\\ufe0f  Output keys {list(result.keys())} match none of the declared "
        f"output ports {output_port_ids}; values may be dropped downstream.",
        file=sys.stderr,
    )
    return result
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
    node_map = {n.id: n for n in graph.nodes}
    node_types = {n.node_type for n in graph.nodes}

    needs_files = bool(node_types & {NodeType.FILE_INPUT, NodeType.DIRECTORY_INPUT, NodeType.OUTPUT})
    needs_files = needs_files or any(
        n.node_type == NodeType.GUI
        and any(w.kind in (GuiWidgetKind.FILE_OPEN, GuiWidgetKind.DIRECTORY_OPEN) for w in n.config.gui_widgets)
        for n in graph.nodes
    )
    needs_code_runner = bool(node_types & {NodeType.CODE}) or any(
        n.node_type == NodeType.DIRECTORY_INPUT and not n.config.select_all_files and n.config.selector_code.strip()
        for n in graph.nodes
    )
    needs_code_runner = needs_code_runner or any(
        n.node_type == NodeType.GUI and any(w.code.strip() for w in n.config.gui_widgets)
        for n in graph.nodes
    )
    needs_ai = NodeType.AI in node_types
    needs_read_file_inputs = any(
        n.config.read_file_inputs for n in graph.nodes if n.node_type in (NodeType.AI, NodeType.CODE)
    )
    needs_files = needs_files or needs_read_file_inputs

    imports = ["import asyncio", "import json", "import sys"]
    if needs_files:
        imports.append("from pathlib import Path")
    if needs_code_runner:
        imports += ["import os", "import tempfile"]
    elif needs_ai:
        imports.append("import os")
    if needs_read_file_inputs:
        imports.append("import base64")

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
        for line in compile_node(node, sources, node_map):
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
