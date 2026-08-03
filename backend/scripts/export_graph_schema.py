#!/usr/bin/env python3
"""
Export the Graph DSL's Pydantic models as a single JSON Schema document.

This is the bridge half of the backend/frontend schema-deduplication story
(see AGENTS.md's "Shared contracts" section): `backend/app/models/graph.py` is
the one authored schema, and `frontend/src/types/graph.generated.ts` is
generated from this script's output by `frontend/scripts/genTypes.mjs` (run
via `npm run gen:types`). Nothing here has any side effect on the app itself
-- it only imports models and introspects them.

Usage:
    python scripts/export_graph_schema.py            # prints JSON to stdout
    python scripts/export_graph_schema.py out.json    # writes JSON to a file
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# Allow running as a plain script (`python scripts/export_graph_schema.py`)
# from the `backend` directory, where `scripts/` itself is not on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic.json_schema import models_json_schema  # noqa: E402

from app.models.graph import (  # noqa: E402
    ExecutionResult,
    Graph,
    GraphEdge,
    GraphMetadata,
    GraphNode,
    GuiWidget,
    NodeConfig,
    NodePosition,
    NodeResult,
    Port,
    RuntimeRequirement,
)

# Every top-level Graph-DSL / execution-result model the frontend needs a
# mirrored TypeScript type for. Nested models/enums (NodeType, DataType,
# AIProvider, GuiWidgetKind, PortKind, ExecutionStatus, ...) are pulled in
# automatically as `$defs` entries because the models below reference them.
_MODELS = [
    Graph,
    GraphMetadata,
    GraphNode,
    GraphEdge,
    NodeConfig,
    GuiWidget,
    Port,
    NodePosition,
    NodeResult,
    ExecutionResult,
    RuntimeRequirement,
]

# Fields whose default value is genuinely treated as "optional, fill in a
# fallback at read time" by the frontend (`widget.w ?? span.w`, ...), rather
# than "always present, safe to read directly" -- these must stay OPTIONAL in
# the generated TS even though every other defaulted field below gets
# tightened to required (see `_tighten_required`).
_LEAVE_OPTIONAL_FIELDS: dict[str, set[str]] = {
    "GuiWidget": {"value", "mode", "code", "language", "x", "y", "w", "h"},
}


def _is_nullable(subschema: dict[str, Any]) -> bool:
    """True if *subschema* (a JSON Schema fragment) accepts `null`."""
    if subschema.get("type") == "null":
        return True
    types = subschema.get("type")
    if isinstance(types, list) and "null" in types:
        return True
    for variant in subschema.get("anyOf", []) + subschema.get("oneOf", []):
        if _is_nullable(variant):
            return True
    return False


def _tighten_required(defs: dict[str, Any]) -> None:
    """
    Pydantic only marks a field "required" in JSON Schema when it has no
    default value. But most models here are always serialised in full over
    the wire (the backend never omits a field with a default), so from the
    frontend's point of view every non-nullable field is in fact always
    present. Widen "required" to match that real guarantee, so e.g.
    `GraphNode.config`/`.inputs`/`.outputs` become required TS fields instead
    of optional ones -- matching how the rest of the frontend already reads
    these objects without null checks. Two kinds of fields are left alone:
    truly optional (`Optional[X] = None`) fields, since they may genuinely be
    absent-as-null (`field?: X | null`); and `_LEAVE_OPTIONAL_FIELDS`, which
    the frontend already treats as optional-with-fallback by convention.
    """
    for def_name, def_schema in defs.items():
        properties = def_schema.get("properties")
        if not properties:
            continue
        leave_optional = _LEAVE_OPTIONAL_FIELDS.get(def_name, set())
        required = set(def_schema.get("required", []))
        for name, subschema in properties.items():
            if name in leave_optional:
                continue
            if not _is_nullable(subschema):
                required.add(name)
        def_schema["required"] = sorted(required)


def _strip_titles(node: Any) -> None:
    """
    Pydantic auto-generates a `title` for every single field (e.g. "Ai Model"
    for `ai_model`), not just for named models/enums. json-schema-to-typescript
    treats any schema fragment with a `title` as its own nameable type, which
    would otherwise hoist a noisy `AiModel = string`-style alias for every
    plain field. Definitions are already named via their `definitions` dict
    key, so these per-field titles serve no purpose for TS generation --
    strip them recursively.
    """
    if isinstance(node, dict):
        node.pop("title", None)
        for value in node.values():
            _strip_titles(value)
    elif isinstance(node, list):
        for item in node:
            _strip_titles(item)


def build_schema() -> dict[str, Any]:
    _, top_level_schema = models_json_schema(
        [(model, "serialization") for model in _MODELS],
        ref_template="#/definitions/{model}",
    )
    defs = top_level_schema.get("$defs", {})
    _tighten_required(defs)
    _strip_titles(defs)
    # Use `Graph` itself as the schema's root object (json-schema-to-typescript
    # names the type generated from the root after the `name` argument the
    # caller passes it) so the generated file's main export is `Graph`, not a
    # meaningless synthetic wrapper interface. Every other model (NodeConfig,
    # GuiWidget, NodeResult, ExecutionResult, RuntimeRequirement, ...) stays
    # reachable/named via `definitions`, either transitively from `Graph` or,
    # for the standalone execution-result models, via `unreachableDefinitions`.
    graph_def = defs.pop("Graph")
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        **graph_def,
        "definitions": defs,
    }



def main() -> None:
    schema = build_schema()
    text = json.dumps(schema, indent=2, sort_keys=True)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
