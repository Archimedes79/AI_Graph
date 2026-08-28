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


def code_extension(holder: Any) -> str:
    """`.js` or `.py`, from whatever object carries a `language` field.

    Four elements had written this same line out; the fifth (image_view) is the
    kind of place where a copy quietly disagrees.
    """
    language = str(getattr(holder, "language", "python") or "python").lower()
    return ".js" if language.startswith(("js", "javascript", "node")) else ".py"


@dataclass(frozen=True)
class Generation:
    """
    How this element's authored body gets written by an AI, declared once.

    The five ✨ Generate buttons in the editor used to be five hand-written call
    sites -- four handlers in NodeEditor plus a kind-switch in GuiWidgetEditor --
    which is why `image_view` had a `code` field and no way to fill it: nobody
    added the sixth branch. Declaring it here (and mirroring it in the frontend
    element definition) means a shell renders one button per element and knows
    nothing about which element it is.

    `contract` is the sentence(s) describing what THIS element will do with the
    generated snippet, so it lives next to the `execute` that does it rather
    than in a shared constants module every shell imports from.

    `inputs`/`outputs` are set only for a sub-snippet whose ports are fixed by
    the element (a selector's `files`, a transform's `value`); `None` means
    "the node's real ports", which is what a code node wants.
    """

    kind: str                       # "code" | "prompt" | "output_format" | "data_format"
    prompt_field: str               # where the user's request is stored
    target_field: str               # where the generated text is written
    prompt_on_node: bool = False    # the ai node's request is node.description
    contract: str = ""
    inputs: Optional[Tuple[str, ...]] = None
    outputs: Optional[Tuple[str, ...]] = None
    guard: str = ""                 # shown when prompt_field is empty
    success: str = ""               # shown when the result arrives


# The directory-mode file selector, declared once because it is implemented
# once: `InputElement` and `InputPickerElement` run the identical
# `run(inputs) -> {files}` contract, one as a node and one as a widget. Same
# reason `widget_input_or_value` below is shared -- the node/widget split is
# not a behavioural difference here, and two copies of a prompt drift.
SELECTOR_GENERATION = Generation(
    kind="code",
    prompt_field="selector_prompt",
    target_field="selector_code",
    contract=(
        '`inputs["files"]` is the full list of rooted file paths found in the '
        'directory. Return only the selected paths as {"files": [...]}.'
    ),
    inputs=("files",),
    outputs=("files",),
    guard="Please describe which files to select first.",
    success="✅ Selector generated!",
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

    def authored_file(self, node: GraphNode) -> Optional[AuthoredFile]:
        """What this node keeps in a file beside the graph, or None.

        Default None: an input or output node has nothing a person writes at
        length, so there is nothing to externalise."""
        return None

    def generation(self) -> Optional[Generation]:
        """How this node type's body is generated by an AI, or None if it isn't.

        Takes no node: this is a property of the element, not of one instance,
        which is what lets the server resolve it from a request that names only
        the element. Whether the button is *offered* on a particular node (an
        input node selects files only in directory mode) is the editor's call --
        see `NodeElementDefinition.available` on the frontend.

        Default None: an `output` node has no authored body, and a `gui` node is
        a composite whose widgets answer this for themselves."""
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

    def generation(self) -> Optional[Generation]:
        """Same contract as `NodeElement.generation`, one level down."""
        return None

    def deploy_needs(self, widget: GuiWidget) -> DeployNeeds:
        """What this widget needs from the deployed bundle. Default: nothing
        extra -- the sandboxed runner a data-transform snippet uses is vendored
        unconditionally."""
        return DeployNeeds()
