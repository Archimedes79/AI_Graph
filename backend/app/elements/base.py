"""
Object-oriented core of the Graph DSL.

Every `NodeType` and `GuiWidgetKind` is exactly one class ("element") owning ALL
of its behavior in one file: live execution, deploy-script codegen, and (for
widgets) which ports it contributes. See AGENTS.md's "Entity contract" section
for the full list of what an element must implement and what it can assume
about the surrounding engine.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar, Dict, List, Optional, Tuple

from app.models.graph import GraphNode, GuiWidget, GuiWidgetKind, NodeType, Port

# Compile-time (deploy codegen) context shapes, built once per graph by
# deploy_service.py and passed into every element's `compile`.
Sources = Dict[Tuple[str, str], List[Tuple[str, str]]]
NodeMap = Dict[str, GraphNode]


class NodeElement(ABC):
    """
    Everything one `NodeType` needs to behave as a graph node:
      - `execute`  -- live execution (editor "Run Graph", the HTTP API, the CLI).
      - `compile`  -- deploy-bundle codegen (the self-contained runner script).
    Both must produce equivalent results for equivalent inputs: that
    equivalence is the entire point of the deploy feature.

    A NodeElement instance is stateless and shared (one singleton per kind,
    registered in `elements.registry.NODE_ELEMENTS`); all node-specific state
    lives in the `GraphNode` argument, never on `self`.
    """

    node_type: ClassVar[NodeType]

    @abstractmethod
    async def execute(
        self,
        node: GraphNode,
        inputs: Dict[str, Any],
        effective_formats: Optional[Dict[str, Optional[str]]] = None,
    ) -> Dict[str, Any]:
        """Run this node once for the given already-resolved/decoded inputs."""

    @abstractmethod
    def compile(self, node: GraphNode, sources: Sources, node_map: NodeMap) -> List[str]:
        """Return the deploy-script source lines that reproduce `execute` at compile time."""


class GuiWidgetElement(ABC):
    """
    Everything one `GuiWidgetKind` needs to behave as a `gui` node's
    sub-element -- the same three facets as NodeElement, one level down in the
    object hierarchy. A `gui` node's own NodeElement (`elements/gui/gui_element.py`)
    is a Composite: its `execute`/`compile` dispatch to each of its widgets'
    GuiWidgetElement in turn (looked up in `registry.GUI_WIDGET_ELEMENTS`) and
    merge their results, which is what makes the gui node "an object hierarchy
    whose lowest level again supports graph elements."
    """

    widget_kind: ClassVar[GuiWidgetKind]

    @abstractmethod
    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        """The (inputs, outputs) this widget contributes to its owning gui node."""

    @abstractmethod
    def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        """
        Compute this widget's `{id}_out` port value. Display-only widgets with
        no output port (currently only plot_window) instead mutate `inputs` in
        place and their return value is ignored -- see `gui/element.py`.
        """

    @abstractmethod
    def compile(self, node: GraphNode, widget: GuiWidget) -> List[str]:
        """Deploy-script lines for this one widget, mirroring `execute`."""
