"""
How an element's body gets written by an AI, asked of the engine.

The elements live in the engine, in one language, and they declare this next to
the `logic()` that says where the body is kept -- both built from one constant
per element, so the button cannot write into a field nothing runs. This module
is only the shape that answer arrives in on this side.

Cached for the life of the process: a generation descriptor is a property of the
element, not of a node, so it does not change while the engine is up.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from app.services import engine_client


@dataclass(frozen=True)
class Generation:
    """One element's answer, flattened. Field names follow the wire."""

    kind: str                                  # "code" | "prompt" | "output_format" | "data_format"
    target_field: str                          # where the generated text is written
    prompt_field: str                          # where the request is stored
    prompt_on_node: bool = False               # the ai node's request is node.description
    contract: str = ""
    # Set only for a sub-snippet whose ports the element fixes (a selector's
    # `files`, a transform's `value`). None means "the node's real ports", which
    # is what a code node wants.
    inputs: Optional[Tuple[str, ...]] = None
    outputs: Optional[Tuple[str, ...]] = None
    guard: str = ""
    success: str = ""

    @classmethod
    def from_engine(cls, row: Dict[str, Any]) -> "Generation":
        return cls(
            kind=str(row["kind"]),
            target_field=str(row["target_field"]),
            prompt_field=str(row["prompt_field"]),
            prompt_on_node=bool(row.get("prompt_on_node")),
            contract=str(row.get("contract") or ""),
            inputs=tuple(row["inputs"]) if row.get("inputs") else None,
            outputs=tuple(row["outputs"]) if row.get("outputs") else None,
            guard=str(row.get("guard") or ""),
            success=str(row.get("success") or ""),
        )


_cache: Optional[Dict[str, Generation]] = None


async def all_generations() -> Dict[str, Generation]:
    """Every element that can have its body written for it, by name."""
    global _cache
    if _cache is None:
        raw = await engine_client.get("/api/elements/generation")
        _cache = {name: Generation.from_engine(row) for name, row in raw.items()}
    return _cache


async def generation_for(element: str) -> Optional[Generation]:
    """The descriptor for one element, or None if it authors nothing.

    Node types and block kinds share one namespace, because a caller has one
    name and no reason to know which level it came from.
    """
    return (await all_generations()).get(element)


def forget() -> None:
    """Drop the cache. For tests that restart the engine under it."""
    global _cache
    _cache = None
