"""
Deployment service.

Assembles a deploy bundle that ships the ACTUAL runtime -- `app/elements`,
`app/models`, and the portable subset of `app/services` -- copied verbatim,
plus the user's `graph.json` and a thin `main.py` (the exact source of
`graph-runner/run.py`). There is no per-node codegen: a deployed graph runs
the same `execute_graph()` as the live editor/CLI, so the two can never
diverge. See AGENTS.md's "Object-oriented element contract" section.

What a bundle may contain is a closed list, and that list is the licence
boundary: the vendored engine, the runner scripts, the runtime page, the user's
graph -- and `LICENSE-runtime`, which covers exactly those. No editor file is
ever vendored; `tests/test_deploy_boundary.py` fails if one starts to be.

Every script this module ships is likewise an existing repo file copied
verbatim, never a string assembled here: `main.py` is `graph-runner/run.py`
and `build_exe.py` is `graph-runner/build_exe.py`. Only the few files that
genuinely depend on the graph (requirements.txt, Dockerfile, compose, README)
are generated.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path
from typing import Dict, Union

Bundle = Dict[str, Union[str, bytes]]

from app.elements.base import DeployNeeds
from app.elements.registry import NODE_ELEMENTS
from app.models.graph import Graph
from app.services import ai_settings, code_env

# Root of the actual `app` package this module lives in -- what gets vendored
# into the bundle's app/ folder verbatim (never regenerated/rewritten).
# Repo root: only consulted at *build* time to locate graph-runner/run.py to
# embed as main.py; the emitted bundle has no dependency on this layout.
# A PyInstaller build of the editor has no repo around it, so it ships these
# same trees as data under sys._MEIPASS and vendoring reads them from there --
# which is why build_editor_exe.py must add-data app/ and graph-runner/ as
# source, not just as importable modules.
if getattr(sys, "frozen", False):
    _REPO_ROOT = Path(sys._MEIPASS)
    _APP_ROOT = _REPO_ROOT / "app"
else:
    _APP_ROOT = Path(__file__).resolve().parent.parent
    _REPO_ROOT = _APP_ROOT.parent.parent
# The built editor frontend. Its `runtime.html` entry is the page a GUI bundle
# serves (see graph-runner/serve.py); absent in a checkout that has never run
# `npm run build`, in which case a GUI graph still deploys -- as a headless CLI
# bundle, with the README saying why.
_FRONTEND_DIST = _REPO_ROOT / "frontend" / "dist"

# Only these app/services/*.py modules are portable (no FastAPI/HTTP-framework
# dependency) and are what graph_executor.py's import chain actually needs;
# routers/, main.py, and this module itself are server-only and never vendored.
_PORTABLE_SERVICE_MODULES = [
    "__init__.py",
    "ai_service.py",
    "ai_settings.py",
    "batching.py",
    "code_executor.py",
    "file_service.py",
    "code_env.py",
    "graph_executor.py",
    "run_registry.py",
    # ai_service imports it for the code-generation prompt, which a bundle still
    # reaches: an input node whose selector was never generated in the editor
    # generates one on its first run.
    "skeleton.py",
]


def _iter_py_files(root: Path):
    """Yield every .py file under *root*, skipping __pycache__ directories."""
    for path in sorted(root.rglob("*.py")):
        if "__pycache__" not in path.parts:
            yield path


def _vendor_app_files() -> Dict[str, str]:
    """
    {bundle-relative path: file content} for every real source file the live
    engine needs: the whole `elements/` tree, `models/graph.py`, and the
    portable `services/*.py` modules above -- copied verbatim, never
    regenerated.
    """
    files: Dict[str, str] = {"app/__init__.py": (_APP_ROOT / "__init__.py").read_text(encoding="utf-8")}

    for path in _iter_py_files(_APP_ROOT / "elements"):
        rel = path.relative_to(_APP_ROOT)
        files[f"app/{rel.as_posix()}"] = path.read_text(encoding="utf-8")

    for name in ("__init__.py", "graph.py"):
        files[f"app/models/{name}"] = (_APP_ROOT / "models" / name).read_text(encoding="utf-8")

    for name in _PORTABLE_SERVICE_MODULES:
        files[f"app/services/{name}"] = (_APP_ROOT / "services" / name).read_text(encoding="utf-8")

    return files


def _deploy_needs(graph: Graph) -> DeployNeeds:
    """
    What this graph needs from its bundle, aggregated via each element's
    `deploy_needs` -- the same per-element contract `get_runtime_requirements`
    dispatches through, so nothing here branches on node.node_type itself.
    """
    needs = DeployNeeds()
    for node in graph.nodes:
        element = NODE_ELEMENTS.get(node.node_type)
        if element is not None:
            needs = needs | element.deploy_needs(node)
    return needs


def _serves_gui(needs: DeployNeeds) -> bool:
    """Whether this bundle ships the browser runtime: the graph has an
    interactive node AND a built frontend exists to serve for it."""
    return needs.interactive_ui and (_FRONTEND_DIST / "runtime.html").is_file()


def _requirements_txt(graph: Graph, needs: DeployNeeds) -> str:
    """
    pip requirements for the bundle: pydantic always (app.models.graph), httpx
    only when the graph makes AI calls, and the web server only when the bundle
    actually ships a GUI. A headless bundle stays a two-dependency install.

    Whatever the graph's own code nodes declare is listed separately at the end.
    Those are not dependencies of the engine -- they belong to the environment
    code nodes run in (see services/code_env.py) and are installed there by
    `python main.py --install-requirements`. Listing them here anyway is what
    stops a bundle from arriving with no record of what its graph imports.
    """
    lines = ["pydantic==2.13.4"]
    if needs.ai:
        lines.append("httpx==0.28.1")
    if _serves_gui(needs):
        lines.append("fastapi==0.141.1")
        lines.append("uvicorn[standard]==0.52.1")

    node_requirements = code_env.graph_requirements(graph)
    if node_requirements:
        lines.append("")
        lines.append("# Declared by this graph's code nodes. Installed into the code-node")
        lines.append("# environment by `python main.py --install-requirements`, not here.")
        lines.extend(node_requirements)

    return "\n".join(lines) + "\n"


def _license() -> str:
    """
    The licence a bundle ships under: `LICENSE-runtime`, which covers exactly
    what a bundle contains -- the vendored engine, the runner scripts and the
    runtime page. The editor's own `LICENSE` never travels with a bundle,
    because no editor file does (see `_runtime_static_files` and
    `_PORTABLE_SERVICE_MODULES`). Today the two files hold the same terms;
    keeping them separate is what makes changing the bundle's terms a
    one-file edit instead of a refactor.
    """
    return (_REPO_ROOT / "LICENSE-runtime").read_text(encoding="utf-8")


def _main_py() -> str:
    """
    The bundle's entrypoint: the exact source of graph-runner/run.py, verbatim.
    That file already documents itself as safe to vendor in as main.py -- its
    dev-only sys.path shim for a sibling `backend/` directory is a no-op once
    copied alongside a bundle's own `app/` instead.
    """
    return (_REPO_ROOT / "graph-runner" / "run.py").read_text(encoding="utf-8")


def _build_exe_py() -> str:
    """
    The bundle's PyInstaller build script: the exact source of
    `graph-runner/build_exe.py`, verbatim -- same rule as `main.py` above.
    It turns the bundle into one self-contained executable that needs no
    Python on the target machine, which is the closest thing a graph has to
    a classic software installer.
    """
    return (_REPO_ROOT / "graph-runner" / "build_exe.py").read_text(encoding="utf-8")


def _serve_py() -> str:
    """The bundle's web entry point: the exact source of
    `graph-runner/serve.py`, verbatim -- same rule as `main.py`."""
    return (_REPO_ROOT / "graph-runner" / "serve.py").read_text(encoding="utf-8")


# The editor and the deployed runtime are two entry points of ONE Vite build,
# so `frontend/dist` holds both: `index.html` plus the editor's chunks next to
# `runtime.html` plus the runtime's. A bundle ships only what `runtime.html`
# reaches -- shipping the rest would put the designer into every deployed tool
# and would cross the line `LICENSE-runtime` draws.
_RUNTIME_ENTRY = "runtime.html"
# Suffixes worth scanning for references to other built files. Everything else
# (images, fonts) is a leaf: it can be referenced, it never references.
_REFERENCING_SUFFIXES = {".html", ".js", ".mjs", ".css", ".json", ".map"}


def _runtime_static_files() -> Dict[str, Path]:
    """
    {dist-relative path: file} for `runtime.html` and, transitively, every
    built file it references -- the closure over Vite's content-hashed names.

    Deliberately over-inclusive rather than clever: a file is "referenced" when
    its name appears in another file's text. Vite's hashed names make a false
    positive practically impossible, and the failure mode of a miss (a deployed
    page missing a chunk) is far worse than that of an extra file.
    """
    all_files = {
        path.relative_to(_FRONTEND_DIST).as_posix(): path
        for path in sorted(_FRONTEND_DIST.rglob("*"))
        if path.is_file()
    }
    if _RUNTIME_ENTRY not in all_files:
        return {}

    reachable = {_RUNTIME_ENTRY}
    pending = [_RUNTIME_ENTRY]
    while pending:
        path = all_files[pending.pop()]
        if path.suffix.lower() not in _REFERENCING_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for rel, candidate in all_files.items():
            if rel not in reachable and candidate.name in text:
                reachable.add(rel)
                pending.append(rel)

    return {rel: all_files[rel] for rel in sorted(reachable)}


def _vendor_static_files() -> Bundle:
    """
    The runtime half of the built frontend, copied into the bundle as
    `static/`. Read as bytes so a binary asset (a font, an image) ships intact;
    text files stay text only by virtue of being written back out unchanged.
    """
    return {
        f"static/{rel}": path.read_bytes()
        for rel, path in _runtime_static_files().items()
    }


def _dockerfile(needs: DeployNeeds) -> str:
    if _serves_gui(needs):
        return textwrap.dedent(
            """\
            FROM python:3.11-slim
            WORKDIR /app
            COPY requirements.txt .
            RUN pip install --no-cache-dir -r requirements.txt
            COPY app/ ./app/
            COPY static/ ./static/
            COPY graph.json .
            COPY main.py .
            COPY serve.py .
            EXPOSE 8000
            CMD ["python", "serve.py", "--host", "0.0.0.0", "--no-browser"]
            """
        )
    return _cli_dockerfile()


def _cli_dockerfile() -> str:
    return textwrap.dedent(
        """\
        FROM python:3.11-slim
        WORKDIR /app
        COPY requirements.txt .
        RUN pip install --no-cache-dir -r requirements.txt
        COPY app/ ./app/
        COPY graph.json .
        COPY main.py .
        CMD ["python", "main.py"]
        """
    )


def _readme(graph: Graph, needs: DeployNeeds) -> str:
    gui_section = ""
    if _serves_gui(needs):
        gui_section = textwrap.dedent(
            """\
            ## Run it (browser interface)
                pip install -r requirements.txt
                python serve.py

            Opens the tool's own page in your browser: the file pickers, text
            windows and plots this graph was designed with, rendered by the
            same components the editor used. `--port`, `--host 0.0.0.0` and
            `--no-browser` are available; the page's gear icon points the tool
            at a different AI without touching the graph.

            """
        )
    example_settings = json.dumps(ai_settings.example_settings(), indent=2)
    return textwrap.dedent(
        f"""\
        # {graph.metadata.name} — deployment bundle

        Self-contained runner generated by AI-Graph. `app/` is the real AI-Graph
        execution engine (elements + services + models), vendored verbatim -- this
        bundle runs the exact same code as the editor, not a regenerated equivalent.

        {gui_section}## Run on the command line
            python -m venv .venv
            . .venv/bin/activate          # Windows: .venv\\Scripts\\activate
            pip install -r requirements.txt
            python main.py graph.json

        ## Choose which AI this tool calls
        Every AI step left on the graph's default follows one setting, so you
        configure it once rather than per step. In order of precedence:

            python main.py --ai-provider lmstudio --ai-model qwen2.5-coder-7b
            AI_GRAPH_AI_PROVIDER=lmstudio AI_GRAPH_AI_MODEL=qwen2.5-coder-7b python main.py

        ...or create `ai-settings.json` next to this file (or next to the
        executable, if you built one) and it is picked up automatically:

        ```json
        {example_settings}
        ```

        Add `--ai-force` to override even the steps that pin a provider of
        their own.

        ## Build a standalone executable (no Python on the target machine)
            pip install pyinstaller
            python build_exe.py

        Produces `dist/` containing a single executable with `graph.json`
        embedded. Ship that one file -- the recipient needs no Python, no pip
        and no AI-Graph install. Dropping a `graph.json` next to the
        executable overrides the embedded one, so the same binary can be
        re-pointed at an edited graph without rebuilding.

        ## Run with Docker Compose
            docker compose up --build

        Set AI-provider credentials via environment variables as needed:
        `OLLAMA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `LMSTUDIO_BASE_URL`.
        """
    )


def generate_docker_compose(graph: Graph, image_tag: str = "ai-graph-runner:latest") -> str:
    """Return a docker-compose.yml string for running the vendored bundle."""
    name = graph.metadata.name.lower().replace(" ", "-")
    ports = '        ports:\n          - "8000:8000"\n' if _serves_gui(_deploy_needs(graph)) else ""

    return textwrap.dedent(
        f"""\
        version: "3.9"

        services:
          {name}-runner:
            build: .
            image: {image_tag}
{ports}            environment:
              - OLLAMA_BASE_URL=${{OLLAMA_BASE_URL:-http://ollama:11434}}
              - OPENAI_API_KEY=${{OPENAI_API_KEY:-}}
              - ANTHROPIC_API_KEY=${{ANTHROPIC_API_KEY:-}}
            volumes:
              - ./data:/data

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


def generate_deployment_bundle(graph: Graph) -> Bundle:
    """
    Return {bundle-relative path: content} for a full, ready-to-run deployment
    bundle. Content is text, except the vendored `static/` assets, which are
    bytes.
    bundle:
      - app/**             – the real execution engine, vendored verbatim
      - graph.json         – the graph definition itself
      - main.py            – graph-runner/run.py, verbatim
      - build_exe.py       – graph-runner/build_exe.py, verbatim (PyInstaller
                             one-file build; no Python needed on the target)
      - requirements.txt   – pip deps (pydantic always, httpx if the graph uses AI)
      - Dockerfile / docker-compose.yml / README.md – optional run helpers
    Unlike the old codegen approach, the graph definition IS needed at runtime
    (main.py loads graph.json), since there is no more per-graph baked script.
    """
    needs = _deploy_needs(graph)
    bundle: Bundle = dict(_vendor_app_files())
    bundle["graph.json"] = graph.model_dump_json(indent=2)
    bundle["main.py"] = _main_py()
    bundle["build_exe.py"] = _build_exe_py()
    if _serves_gui(needs):
        bundle["serve.py"] = _serve_py()
        bundle.update(_vendor_static_files())
    bundle["requirements.txt"] = _requirements_txt(graph, needs)
    bundle["Dockerfile"] = _dockerfile(needs)
    bundle["docker-compose.yml"] = generate_docker_compose(graph)
    bundle["README.md"] = _readme(graph, needs)
    # A bundle vendors the engine verbatim and is handed to someone else, so it
    # is a distribution of the software -- and the licence's Notices section
    # requires that whoever receives any part of it also receives the terms.
    bundle["LICENSE"] = _license()
    return bundle
