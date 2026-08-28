import type React from 'react';
import type { GraphNode, GuiWidget, GuiWidgetKind, NodeType, Port } from '../types/graph';
import type { GuiWidgetRuntimeProps } from '../components/gui/widgetProps';

/**
 * Everything one NodeType needs to behave as a graph node on the frontend:
 * `ConfigEditor` is "draw + interact + save/load" for the node's config panel
 * (NodeEditor.tsx dispatches to it), `create` is "interact with the user" at
 * node-creation time (Sidebar.tsx drag/drop -> graphStore.addNode). Live
 * execution and deploy codegen are backend-only concerns -- see
 * `backend/app/elements/base.py` and AGENTS.md's "Entity contract" section.
 */
export interface NodeElementDefinition {
  nodeType: NodeType;
  ConfigEditor: React.ComponentType<any>;
  create: (id: string) => GraphNode;
  /**
   * What this node type keeps in a file beside the graph, mirroring the
   * backend's `NodeElement.authored_file()`. Omitted for a type with nothing a
   * person writes at length (input, output), which is what decides whether
   * NodeEditor offers the option at all -- so the offer follows the element
   * rather than a list of node types kept somewhere else.
   */
  authoredFile?: (node: GraphNode) => { extension: string; what: string };
}

/**
 * Everything one GuiWidgetKind needs to behave as a `gui` node's sub-element,
 * mirroring NodeElementDefinition one level down: `ports` is what the owning
 * gui node's inputs/outputs are synchronized from (`syncGuiNodePorts` /
 * backend `sync_gui_node_ports`), `ConfigEditor` is the widget's row in
 * GuiWidgetEditor.tsx, `RuntimeWidget` is what actually draws in the floating
 * GuiWindow and lets the user interact with it.
 */
export interface GuiWidgetElementDefinition {
  widgetKind: GuiWidgetKind;
  ports: (widget: GuiWidget) => { inputs: Port[]; outputs: Port[] };
  ConfigEditor: React.ComponentType<any>;
  RuntimeWidget: React.ComponentType<GuiWidgetRuntimeProps>;
  // Optional: widget's stored value is a one-shot "message" that should be
  // cleared once a run has consumed it (e.g. a chat-style text_io widget),
  // rather than being resent on every subsequent round. Omitted/false for
  // widgets whose value is a persistent setting (e.g. input_picker's path).
  clearValueAfterRun?: (widget: GuiWidget) => boolean;
}
