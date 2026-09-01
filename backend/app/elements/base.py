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

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, ClassVar, List, Optional, Tuple

from app.models.graph import DataType, GuiWidget, GuiWidgetKind, NodeType, Port, PortKind

logger = logging.getLogger(__name__)




@dataclass(frozen=True)
class AuthoredFile:
    """
    Which of an element's fields is the text a person authors, and which prompt
    produced it.

    Every element turns out to have the same shape here -- one authored body and
    one prompt that generated it -- so externalising a node to a file beside the
    graph is one mechanism (`services/node_files.py`) parameterised per element,
    rather than a branch per node type in the router:

        code  -> config.code            from config.code_prompt      .js
        ai    -> config.system_prompt   from node.description        .md
        data  -> config.data_format_prompt  from config.data_prompt  .md

    `extension` is what makes the file useful in another editor, so it follows
    the content: real code gets .js and a language server with it; prose gets
    .md, because prose in a .js is a syntax error. A field that becomes a
    schema declaration rather than prose is one character of change here.
    """

    body_field: str
    prompt_field: str = ""
    extension: str = ".md"
    # Where the prompt lives: config (the default) or the node itself, as the
    # ai node's description does.
    prompt_on_node: bool = False


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


# `NodeConfig` fields that belong to no single element, so every element may
# read them and none has to declare them:
#   example_file -- the one sample attached to a node, read by every ✨ generate
#   code_file    -- the authored file's name, uniform across authoring elements
#                   (`node_files.Authored.file_name` reads it for all of them)
#   extra        -- the DSL's documented passthrough bag
SHARED_CONFIG_FIELDS: Tuple[str, ...] = ("example_file", "code_file", "extra")


class Element(ABC):
    """
    What a node and a GUI widget have in common, which is nearly everything.

    `NodeElement` and `GuiWidgetElement` declared `authored_file` and
    `generation` separately, with identical signatures and identical
    meanings -- and `gui_element.py` already calls itself a Composite, a pattern
    whose whole point is that leaf and container implement one component
    interface. They did not. The cost was concrete: `node_files.Authored`
    existed only to view the two through one lens, and `input`/`input_picker` --
    documented as "the same contract implemented once at both levels" -- had
    already drifted apart in the code that runs their shared selector.

    What stays split, one level down, is what genuinely differs: a node is
    addressed by the graph and has real ports; a widget is addressed by its
    owning node and derives `{id}_in`/`{id}_out`. Forcing those into one shape
    would buy uniformity by making every reader carry fields that never apply.

    This is the *authoring* half only. Running a body belongs to the engine's
    `Logic` (`engine/src/logic.ts`), which is also where the editor now asks
    what an element authors -- so the pair below is the last place the question
    is answered twice, and it is answered from the same field names.
    """

    # Which config fields this element owns -- see `NodeElement.config_fields`
    # below for why the question needs asking at all. On a widget these name
    # `GuiWidget` fields instead; the question is the same one level down.
    config_fields: ClassVar[Tuple[str, ...]] = ()

    # ---- the snippet this element authors ------------------------------------

    # What a failure of that snippet costs. "fatal" fails the element and, with
    # it, the node; "cosmetic" is displayed and nothing downstream notices --
    # correct for a display widget, whose transform breaking must not take its
    # sibling widgets down with it.
    snippet_failure: ClassVar[str] = "fatal"

    def authored_file(self, subject: Any) -> Optional[AuthoredFile]:
        """What this element keeps in a file beside the graph, or None.

        Default None: an input or output node has nothing a person writes at
        length, so there is nothing to externalise."""
        return None

    def generation(self) -> Optional[Generation]:
        """How this element's body is written by an AI, or None if it isn't.

        Takes no subject: this is a property of the element, not of one
        instance, which is what lets the server resolve it from a request that
        names only the element. Whether the button is *offered* on a particular
        node (an input node selects files only in directory mode) is the
        editor's call -- see `available` on the frontend definition."""
        return None


class NodeElement(Element):
    """
    Everything one `NodeType` needs to behave as a graph node:
      - `execute` -- run this node, live in the editor/API/CLI, or in a
        deployed bundle (which vendors and runs this exact same code).

    A NodeElement instance is stateless and shared (one singleton per kind,
    registered in `elements.registry.NODE_ELEMENTS`); all node-specific state
    lives in the `GraphNode` argument, never on `self`.
    """

    node_type: ClassVar[NodeType]

    # Which `NodeConfig` fields this element owns -- what its behaviour reads and
    # what its editor writes.
    #
    # `NodeConfig` is one flat model of ~30 fields shared by every node type, so
    # nothing in the DSL said which of them an `output` node has any business
    # with (it uses two). That silence is why `recursive`/`extensions` could sit
    # in `extra` on the input node while being real fields on the widget doing
    # the identical job: with no per-element schema, the untyped bag is the only
    # place a new field obviously fits.
    #
    # Declaring ownership here does not split the wire format -- graphs stay flat
    # and permissive, and old ones load unchanged. It makes the question
    # answerable, and `test_element_contract.py` holds each element to its
    # answer: a field read in an element file and not named here is drift.
    config_fields: ClassVar[Tuple[str, ...]] = ()

    # This node keeps its value between runs, so an edge into it can close a
    # cycle: the executor leaves such an edge out of the topological order and
    # settles the freshly computed value afterwards, for the *next* round.
    #
    # `graph_executor` decided this with a hard-coded
    # `node_type in (DATA, GUI)` -- the last switch on node type in shared
    # backend code, next to a comment anticipating a general-purpose memory
    # node. Asking the element instead is what makes that node a new file rather
    # than an edit to the executor. Mirrored by `isMemory` on the frontend
    # definition; the two must agree, or "memory" means different things
    # depending on which half is asked.
    is_memory: ClassVar[bool] = False




class GuiWidgetElement(Element):
    """
    Everything one `GuiWidgetKind` needs to behave as a `gui` node's
    sub-element -- the same facets as NodeElement, one level down in the
    object hierarchy, and now literally the same base class for the ones that
    do not differ. A `gui` node's own NodeElement (`elements/gui/gui_element.py`)
    is a Composite: its `execute` dispatches to each of its widgets'
    GuiWidgetElement in turn (looked up in `registry.GUI_WIDGET_ELEMENTS`) and
    merges their results, which is what makes the gui node "an object hierarchy
    whose lowest level again supports graph elements."
    """

    widget_kind: ClassVar[GuiWidgetKind]

    @abstractmethod
    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        """The (inputs, outputs) this widget contributes to its owning gui node."""





class StaticWidget(GuiWidgetElement):
    """
    A widget that is part of the page rather than part of the graph: a heading,
    a paragraph, a rule. It contributes **no ports at all** and never executes.

    An interface built only from inputs and outputs cannot be laid out -- there
    was no way to write a title. These are what make a gui node a document
    rather than a stack of labelled boxes, and they are elements like any other
    so that the designer, the runtime window and the deploy bundle need to learn
    nothing about them.

    Their text is `widget.value`, the same field every other widget holds its
    own content in.
    """

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        return ([], [])

class DisplayWidget(GuiWidgetElement):
    """
    A widget that only shows what arrives: one input port, no output port, and
    an optional transform whose failure is cosmetic.

    `plot_window` and `image_view` had byte-identical `ports()`,
    `authored_file()` and `execute()` -- three methods and about a hundred lines
    written out twice -- and differed in exactly the three strings describing
    what their snippet should produce. That is duplication, not a design, and it
    is the reason this one intermediate class exists: it carries code, not a
    label.
    """

    # The generated snippet reshapes a value for display; if it raises, the
    # widget shows the reason and its siblings carry on.
    snippet_failure = "cosmetic"

    def ports(self, widget: GuiWidget) -> Tuple[List[Port], List[Port]]:
        return (
            [Port(id=f"{widget.id}_in", name=widget.label or widget.id, kind=PortKind.INPUT,
                  data_type=DataType.ANY, multi=True, required=False)],
            [],
        )

    def authored_file(self, widget: GuiWidget) -> AuthoredFile:
        """The optional transform that reshapes the incoming value."""
        return AuthoredFile(body_field="code", prompt_field="code_prompt",
                            extension='.js')
