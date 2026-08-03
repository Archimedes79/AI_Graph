"""
Object-oriented core of the Graph DSL.

Every `NodeType` and `GuiWidgetKind` is exactly one class ("element") owning ALL
of its behavior in one file: live execution and (for widgets) which ports it
contributes. Deploy bundles ship this exact code (see `deploy_service.py`)
rather than a regenerated equivalent, so there is no separate codegen contract
to implement. See AGENTS.md's "Object-oriented element contract" section for
the full list of what an element must implement and what it can assume about
the surrounding engine.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, Dict, List, Optional, Tuple

from app.models.graph import GraphNode, GuiWidget, GuiWidgetKind, NodeType, Port


@dataclass
class DeployNeeds:
    """
    What one node's (or widget's) behavior needs from the deployed bundle's
    `requirements.txt` / optional runtime setup -- aggregated across every node
    via `|`. All fields default to False: most elements need nothing extra.
    """

    files: bool = False          # file_service helpers (resolve_path, read/write, ...)
    code_runner: bool = False    # sandboxed Python/JS execute_code helper
    ai: bool = False             # ai_service completion helper
    read_file_inputs: bool = False  # implies `files` too; see generate_runner_script

    def __or__(self, other: "DeployNeeds") -> "DeployNeeds":
        return DeployNeeds(
            files=self.files or other.files,
            code_runner=self.code_runner or other.code_runner,
            ai=self.ai or other.ai,
            read_file_inputs=self.read_file_inputs or other.read_file_inputs,
        )


class NodeElement(ABC):
    """
    Everything one `NodeType` needs to behave as a graph node:
      - `execute` -- run this node, live in the editor/API/CLI, or in a
        deployed bundle (which vendors and runs this exact same code).

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

    def runtime_requirements(self, node: GraphNode) -> List[Dict[str, Any]]:
        """
        Requirement dicts (`{node_id, label, kind, direction, current_value}`,
        matching `RuntimeRequirement`'s fields) this node instance wants the user
        prompted for before the graph runs -- web UI dialog, CLI, or a deployed
        bundle's stdin prompts. Default: none; most node types never prompt for
        anything at runtime.
        """
        return []

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        """What this node instance needs from the deployed bundle's optional
        runtime setup / requirements.txt. Default: nothing extra."""
        return DeployNeeds()


def widget_input_or_value(widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
    """A widget's incoming wired value, falling back to its own stored value.

    Shared by widget kinds that are simple overridable pickers (file_open,
    directory_open) -- kinds with different precedence (e.g. chat_window,
    where the widget's own value wins first) implement it inline instead.
    """
    raw = inputs.get(f"{widget.id}_in")
    return raw if raw is not None else widget.value


class GuiWidgetElement(ABC):
    """
    Everything one `GuiWidgetKind` needs to behave as a `gui` node's
    sub-element -- the same facets as NodeElement, one level down in the
    object hierarchy. A `gui` node's own NodeElement (`elements/gui/gui_element.py`)
    is a Composite: its `execute` dispatches to each of its widgets'
    GuiWidgetElement in turn (looked up in `registry.GUI_WIDGET_ELEMENTS`) and
    merges their results, which is what makes the gui node "an object hierarchy
    whose lowest level again supports graph elements."
    """

    widget_kind: ClassVar[GuiWidgetKind]

    @abstractmethod
    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        """The (inputs, outputs) this widget contributes to its owning gui node."""

    @abstractmethod
    async def execute(self, widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
        """
        Compute this widget's `{id}_out` port value. Display-only widgets with
        no output port (currently only plot_window) instead mutate `inputs` in
        place and their return value is ignored -- see `gui/element.py`. Async
        so a widget can await a sandboxed code run / AI call (e.g. input_picker's
        directory-mode file selector) exactly like a NodeElement can.
        """

    def runtime_requirement(self, widget: GuiWidget) -> Optional[Dict[str, Any]]:
        """This widget's own requirement dict (`{label, kind}`), or None if it
        never prompts at runtime. Default: never (only a picker widget with no
        preset value does; see input_picker_element.py)."""
        return None

    def deploy_needs(self, widget: GuiWidget) -> DeployNeeds:
        """Default: a widget needs the sandboxed code runner iff it carries a
        non-empty data-transform snippet (see GuiWidget.code); most widget kinds
        don't need to override this."""
        return DeployNeeds(code_runner=bool(widget.code and widget.code.strip()))
