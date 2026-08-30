import type React from 'react';
import type { GraphNode, GuiWidget, GuiWidgetKind, NodeType, Port } from '../types/graph';
import type { GuiWidgetRuntimeProps } from '../components/gui/widgetProps';
import type { ElementGeneration } from './shared/generation';

/**
 * Everything one NodeType needs to behave as a graph node on the frontend:
 * `ConfigEditor` is "draw + interact + save/load" for the node's config panel
 * (NodeEditor.tsx dispatches to it), `create` is "interact with the user" at
 * node-creation time (Sidebar.tsx drag/drop -> graphStore.addNode). Live
 * execution and deploy codegen are backend-only concerns -- see
 * `backend/app/elements/base.py` and AGENTS.md's "Entity contract" section.
 */
/**
 * What a node definition and a widget definition have in common -- the frontend
 * half of `Element` in `backend/app/elements/base.py`.
 *
 * They are two interfaces rather than one because what differs genuinely
 * differs: only a node is created from the palette (`create`), only a widget
 * derives ports and draws itself at runtime. Merging them into a single
 * interface with everything optional would drop the guarantee that a node type
 * *has* a `create` -- uniformity bought by making every reader check for fields
 * that always exist.
 */
export interface ElementDefinitionBase<S> {
  /** The element's own config panel; the shell renders it and knows nothing else. */
  ConfigEditor: React.ComponentType<any>;
  /**
   * What this element keeps in a file beside the graph, mirroring the backend's
   * `Element.authored_file()`. Omitted for an element with nothing a person
   * writes at length (input, output), which is what decides whether the editor
   * offers the option at all -- so the offer follows the element rather than a
   * list of types kept somewhere else.
   */
  authoredFile?: (subject: S) => { extension: string; what: string } | undefined;
  /**
   * The ✨ Generate button this element offers, mirroring the backend's
   * `Element.generation()`. Omitted for an element that generates nothing
   * (output, text_io), which is what decides whether a button is drawn at all --
   * so the offer follows the element rather than a switch in a shell.
   */
  generation?: ElementGeneration<S>;
}

export interface NodeElementDefinition extends ElementDefinitionBase<GraphNode> {
  nodeType: NodeType;
  create: (id: string) => GraphNode;
  /**
   * What this node emits, in one line, for the neighbours' generation context.
   * This replaced a `switch (node.node_type)` in shared code: the last one.
   */
  describeOutput?: (node: GraphNode) => string;
  /**
   * How this node declares its output, rendered in the Config panel under the
   * body. `'format'` is the editable output_format contract (ai, code);
   * `'widgets'` is the derived summary a gui node shows. Omitted means the node
   * has nothing to declare -- there is no separate Output tab any more, so this
   * is the whole answer to "what comes out of here".
   */
  outputContract?: 'format' | 'widgets';

  // ---- facets shared shells used to decide by node_type ---------------------
  // Each of these replaced a `node.node_type === '…'` written into a component
  // or the store. They are here for the same reason `describeOutput` is: the
  // shell asks the element, so a new node type answers in its own file and
  // nothing shared changes.

  /**
   * This node keeps its value between runs, so an edge into it can close a
   * cycle -- the executor excludes such an edge from topological ordering and
   * settles the fresh value afterwards for the *next* round.
   *
   * Must agree with the backend's `NodeElement.is_memory`: memory meaning two
   * different things depending on which half is asked would be worse than the
   * hard-coded list this replaced.
   */
  isMemory?: boolean;

  /**
   * Store a value that arrived on *portId* as this node's remembered state, so
   * the next run starts from it. Only meaningful when `isMemory`.
   *
   * Where the value goes differs per element -- a data node has one
   * `data_value`, a gui node has one value per widget -- and that was written
   * out as a `node_type === 'data'` branch in the store, twice. The element
   * knows its own storage; the store only knows which edge settled.
   */
  settleMemoryValue?: (node: GraphNode, portId: string, value: unknown) => void;

  /**
   * This element's own editor already covers what the node is for -- a prompt
   * box, a code body -- so the shell must not draw a second "Description" field
   * above it. For `ai` the description IS the generation prompt, which is why
   * showing it twice was confusing rather than merely redundant.
   */
  ownsDescription?: boolean;

  /** This node carries the graph's interface: it gets a live runtime window. */
  hasRuntimeWindow?: boolean;

  /** Does this particular node display its result in a window when the run ends? */
  showsResultWindow?: (node: GraphNode) => boolean;
}

/**
 * Everything one GuiWidgetKind needs to behave as a `gui` node's sub-element,
 * mirroring NodeElementDefinition one level down: `ports` is what the owning
 * gui node's inputs/outputs are synchronized from (`syncGuiNodePorts` /
 * backend `sync_gui_node_ports`), `ConfigEditor` is the widget's row in
 * GuiWidgetEditor.tsx, `RuntimeWidget` is what actually draws in the floating
 * GuiWindow and lets the user interact with it.
 */
export interface GuiWidgetElementDefinition extends ElementDefinitionBase<GuiWidget> {
  widgetKind: GuiWidgetKind;
  ports: (widget: GuiWidget) => { inputs: Port[]; outputs: Port[] };
  RuntimeWidget: React.ComponentType<GuiWidgetRuntimeProps>;
  // Optional: widget's stored value is a one-shot "message" that should be
  // cleared once a run has consumed it (e.g. a chat-style text_io widget),
  // rather than being resent on every subsequent round. Omitted/false for
  // widgets whose value is a persistent setting (e.g. input_picker's path).
  clearValueAfterRun?: (widget: GuiWidget) => boolean;

  /**
   * Rendered on the graph canvas beneath this widget's input port, showing what
   * last arrived there. Omitted for widget kinds with nothing worth previewing
   * at that size.
   *
   * `GraphNodeComponent` used to look for `kind === 'plot_window'` itself --
   * a widget-kind switch inside the shared node renderer, which is exactly what
   * this contract exists to prevent.
   */
  CanvasPreview?: React.ComponentType<{ data: unknown }>;
}
