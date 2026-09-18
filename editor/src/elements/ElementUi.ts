// The browser half of an element: how it looks and how it is edited.
//
// The mirror of `engine/src/elements/Element.ts`. Every element there has, at
// the same relative path here, up to three facets:
//
//   <Kind>View.tsx    how a widget looks on a page -- the designer and the
//                     deployed tool draw the same component
//   <Kind>Panel.tsx   its settings, in the editor only
//   <Kind>.ui.ts      this contract, filled in: what the shells ask the element
//
// Panels are registered lazily (`lazy(() => import('./…Panel'))`), so a panel
// is its own chunk that the editor loads when an element is opened and a
// deployed tool never loads at all -- the tool gets views, not editors.
//
// Two interfaces rather than one, because what differs genuinely differs:
// only a node is created from the palette (`create`), only a widget draws
// itself on a page (`View`). Merged, with everything optional, every reader
// would have to check for fields that always exist.

import type { ComponentType } from 'react';
import type { GraphNode, GuiWidget, NodeType, WidgetKind } from '@/graph';
import type { ElementGeneration, FieldAccess } from '@/authoring/generation';
import type { WidgetViewProps } from './widgets/WidgetView';

/** What both branches share. `S` is what the element is attached to, `P` what its panel is handed. */
export interface ElementUi<S, P> {
  /**
   * The element's own settings panel; the shell renders it and knows nothing
   * else. Absent for an element with nothing to set: a rule, a gap.
   */
  Panel?: ComponentType<P>;
  /**
   * The ✨ Generate button this element offers, mirroring the engine's
   * `Element.generation()`. Absent for an element that authors nothing, which
   * is what decides whether a button is drawn at all.
   */
  generation?: ElementGeneration<S>;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** What the node editor hands every node panel. A panel takes the part it needs. */
export interface NodePanelProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  setDescription: (value: string) => void;
  /** Present when the element authors a body; see `ElementUi.generation`. */
  generation?: ElementGeneration<GraphNode>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  canGenerate: boolean;
  /** Changes an input node's mode, and the ports that follow from it. */
  applyMode: (mode: 'text' | 'file' | 'directory') => void;
  /** Changes a data node's format, and its ports' data type with it. */
  applyDataFormat: (format: GraphNode['config']['data_format']) => void;
  /** Replaces a gui node's widgets, and the ports that follow from them. */
  applyWidgets: (widgets: GraphNode['config']['gui_widgets']) => void;
  /** An example file whose content is sent along when the body is generated. */
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

/** The folded-away settings most people never touch. */
export type NodeAdvancedPanelProps = Pick<NodePanelProps, 'node' | 'setConfig'>;

export interface NodeUi extends ElementUi<GraphNode, NodePanelProps> {
  nodeType: NodeType;
  /** A new node of this type, as the palette drops it on the canvas. */
  create: (id: string) => GraphNode;
  /**
   * The settings most people never touch, drawn folded away under everything
   * else, so that opening a node shows what it *does* and not a form.
   */
  AdvancedPanel?: ComponentType<NodeAdvancedPanelProps>;
  /** What the folded-away settings are about, in a few words: shown on the fold. */
  advancedSummary?: string;
  /** What this node emits, in one line, for its neighbours' generation context. */
  describeOutput?: (node: GraphNode) => string;
  /**
   * How this node declares its output under its panel: `'format'` is the
   * editable output-format contract (ai, code); `'widgets'` the derived
   * summary a gui node shows. Absent: nothing to declare.
   */
  outputContract?: 'format' | 'widgets';
  /**
   * The panel already covers what the node is for -- a prompt box, a code
   * body -- so the shell draws no separate "Description" field above it.
   */
  ownsDescription?: boolean;
  /** This node carries the graph's interface: it gets a live page. */
  hasRuntimeWindow?: boolean;
  /** Whether this particular node shows its result in a window when the run ends. */
  showsResultWindow?: (node: GraphNode) => boolean;
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** What the widget editor hands every widget panel. */
export interface WidgetPanelProps {
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  /** Present when the element authors a body; see `ElementUi.generation`. */
  generation?: ElementGeneration<GuiWidget>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  canGenerate: boolean;
  /** The panel is drawn wide, for a widget whose body needs the room. */
  expanded: boolean;
  onToggleExpand: () => void;
}

export interface WidgetUi extends ElementUi<GuiWidget, WidgetPanelProps> {
  widgetKind: WidgetKind;
  /**
   * How the widget looks on a page. No `ports` here: which ports a widget
   * contributes is the engine's answer (`WidgetElement.ports`), asked through
   * `guiWidgetPorts`, since ports are what the graph's edges attach to.
   */
  View: ComponentType<WidgetViewProps>;
  /**
   * The widget *is* its text: a heading, a paragraph. Selected on the page
   * being built, it becomes a box to type in, where the words stand.
   */
  inlineText?: boolean;
  /**
   * What the widget shows is its *own* stored value, whatever arrived last run:
   * a conversation, where the reply that arrived is one line of what is shown.
   */
  ownsValue?: boolean;
  /** The stored value is a one-shot message, cleared once a run has consumed it. */
  clearValueAfterRun?: (widget: GuiWidget) => boolean;
  /** Drawn on the canvas under the widget's input port: what last arrived there. */
  CanvasPreview?: ComponentType<{ data: unknown }>;
}
