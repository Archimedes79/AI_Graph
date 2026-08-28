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

    # Only needs that actually change the bundle belong here. `file_service`
    # and `code_executor` are stdlib-only and vendored unconditionally, so
    # "this node reads files" or "this node runs code" can never affect what
    # gets shipped -- fields for those existed, were computed by six elements,
    # and were read by nobody. Add one back the moment a need genuinely changes
    # the bundle; that is exactly what this class is for.

    ai: bool = False             # -> httpx in requirements.txt
    # This node has an interface a user operates while the graph runs, so the
    # bundle must ship the web runtime (serve.py + the built page) rather than
    # falling back to console prompts. Set by the gui element; deploy_service
    # asks for it here instead of inspecting node_type itself.
    interactive_ui: bool = False

    def __or__(self, other: "DeployNeeds") -> "DeployNeeds":
        return DeployNeeds(
            ai=self.ai or other.ai,
            interactive_ui=self.interactive_ui or other.interactive_ui,
        )


@dataclass(frozen=True)
class AuthoredFile:
    """
    Which of an element's fields is the text a person authors, and which prompt
    produced it.

    Every element turns out to have the same shape here -- one authored body and
    one prompt that generated it -- so externalising a node to a file beside the
    graph is one mechanism (`services/node_files.py`) parameterised per element,
    rather than a branch per node type in the router:

        code  -> config.code            from config.code_prompt      .py/.js
        ai    -> config.system_prompt   from node.description        .md
        data  -> config.data_format_prompt  from config.data_prompt  .md

    `extension` is what makes the file useful in another editor, so it follows
    the content: real code gets .py/.js and a language server with it; prose
    gets .md, because prose in a .py is a syntax error. A field that becomes a
    schema declaration rather than prose is one character of change here.
    """

    body_field: str
    prompt_field: str = ""
    extension: str = ".md"
    # Where the prompt lives: config (the default) or the node itself, as the
    # ai node's description does.
    prompt_on_node: bool = False


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

    def authored_file(self, node: GraphNode) -> Optional[AuthoredFile]:
        """What this node keeps in a file beside the graph, or None.

        Default None: an input or output node has nothing a person writes at
        length, so there is nothing to externalise."""
        return None

    def deploy_needs(self, node: GraphNode) -> DeployNeeds:
        """What this node instance needs from the deployed bundle's optional
        runtime setup / requirements.txt. Default: nothing extra."""
        return DeployNeeds()


def widget_input_or_value(widget: GuiWidget, inputs: Dict[str, Any]) -> Any:
    """A widget's incoming wired value, falling back to its own stored value.

    Shared by widget kinds that are simple overridable pickers (input_picker)
    -- kinds with different precedence (e.g. text_io in "both" mode, where the
    widget's own value wins first) implement it inline instead.
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

    async def display_value(self, widget: GuiWidget, value: Any) -> Any:
        """
        Last step before a display-only widget's value is handed to the UI, after
        any transform snippet has run. Default: pass it through unchanged.

        It exists so a widget kind that needs to *prepare* what it shows -- an
        image_view turning a server-side path into something a browser can
        render -- does that in its own file, instead of the shared gui composite
        growing a branch per widget kind.
        """
        return value

    def runtime_requirement(self, widget: GuiWidget) -> Optional[Dict[str, Any]]:
        """This widget's own requirement dict (`{label, kind}`), or None if it
        never prompts at runtime. Default: never (only a picker widget with no
        preset value does; see input_picker_element.py)."""
        return None

    def authored_file(self, widget: GuiWidget) -> Optional[AuthoredFile]:
        """Same contract as `NodeElement.authored_file`, one level down: a gui
        node's file is a folder with one file per widget that authors something."""
        return None

    def deploy_needs(self, widget: GuiWidget) -> DeployNeeds:
        """What this widget needs from the deployed bundle. Default: nothing
        extra -- the sandboxed runner a data-transform snippet uses is vendored
        unconditionally."""
        return DeployNeeds()
