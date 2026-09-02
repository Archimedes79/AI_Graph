// What the editor needs to know about the elements, as data.
//
// Both answers here are element knowledge — which config key holds a body, and
// how an AI writes one — and element knowledge lives in the engine, once. The
// editor asks rather than keeping a second opinion, which is what the copies
// that used to sit beside it could not do without drifting.
//
// A project is a graph plus one file per element that has something written in
// it. Deciding *which* config key holds that text is element knowledge — a
// `Logic` — and element knowledge lives here, in the engine, once. This hands
// the answer out for one whole graph so that the layer writing the files never
// has to know what a code node is, and so the editor's server can stop keeping
// a second opinion about it.
//
// Nodes and blocks are the same question at two levels, so they come back in
// one list: a `widget_id` says which level a row is about, and nothing else
// differs.

import { registry } from './registry.ts';
import { parseWidget } from './elements/gui/element.ts';
import type { Graph } from './graph.ts';
import type { Logic } from './logic.ts';
import type { Generation } from './generation.ts';

/** One authored body: whose it is, and which config keys hold its two halves. */
export interface AuthoredSpec {
  node_id: string;
  /** The block inside a gui node, or `''` when the body belongs to the node. */
  widget_id: string;
  /** The config key holding the text a person writes. */
  body_field: string;
  /** The config key holding the request that produced it. */
  prompt_field: string;
  /** What a file holding this body should be called, at the end. */
  extension: string;
  /** The request is the node's own description rather than a config field. */
  prompt_on_node: boolean;
}

function asSpec(nodeId: string, widgetId: string, logic: Logic): AuthoredSpec {
  return {
    node_id: nodeId,
    widget_id: widgetId,
    body_field: logic.fields.body,
    prompt_field: logic.fields.prompt,
    extension: logic.extension,
    prompt_on_node: logic.fields.promptOnSubject === true,
  };
}

/**
 * Every authored body in *graph*, in the order it is met.
 *
 * An element without a logic contributes nothing: a text input or an output
 * node has no text anybody writes at length, and a file selector only exists
 * while the input is pointed at a directory — which is why this is asked per
 * graph rather than answered once per element type.
 */
export function authoredIn(graph: Graph): AuthoredSpec[] {
  const found: AuthoredSpec[] = [];

  for (const node of graph.nodes) {
    const logic = registry.node(node.node_type)?.logic(node);
    if (logic) found.push(asSpec(node.id, '', logic));

    const widgets = node.config.gui_widgets;
    if (!Array.isArray(widgets)) continue;
    for (const raw of widgets) {
      const widget = parseWidget(raw);
      const widgetLogic = registry.widget(widget.kind)?.logic(widget);
      if (widgetLogic) found.push(asSpec(node.id, widget.id, widgetLogic));
    }
  }

  return found;
}


/** One element's generation descriptor, flattened for the wire. */
export interface GenerationDescriptor {
  kind: string;
  /** The config key the generated text is written into. */
  target_field: string;
  /** The config key holding the request it is written from. */
  prompt_field: string;
  /** That request is the node's own description rather than a config key. */
  prompt_on_node: boolean;
  contract: string;
  /** A sub-snippet's fixed ports; empty means "the node's real ports". */
  inputs: string[];
  outputs: string[];
  guard: string;
  success: string;
}

function flatten(generation: Generation): GenerationDescriptor {
  return {
    kind: generation.kind,
    target_field: generation.fields.body,
    prompt_field: generation.fields.prompt,
    prompt_on_node: generation.fields.promptOnSubject === true,
    contract: generation.contract ?? '',
    inputs: generation.inputs ?? [],
    outputs: generation.outputs ?? [],
    guard: generation.guard,
    success: generation.success,
  };
}

/**
 * Every element that can have its body written for it, by name.
 *
 * Node types and block kinds share one namespace here because a caller has one
 * name and no reason to know which level it came from — the same reason
 * `authoredIn` returns one list.
 */
export function generations(): Record<string, GenerationDescriptor> {
  const found: Record<string, GenerationDescriptor> = {};
  for (const type of registry.nodeTypes()) {
    const generation = registry.node(type)?.generation();
    if (generation) found[type] = flatten(generation);
  }
  for (const kind of registry.widgetKinds()) {
    const generation = registry.widget(kind)?.generation();
    if (generation) found[kind] = flatten(generation);
  }
  return found;
}
