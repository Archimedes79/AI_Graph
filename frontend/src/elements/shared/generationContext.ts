import type { ExecutionResult, GraphNode } from '../../types/graph';
import { describeDataFormat } from '../data/dataElement';

/**
 * Context strings handed to the AI that more than one editor needs.
 *
 * The directory file-selector contract is implemented once in the backend
 * (`InputElement` and `InputPickerElement` both run `run(inputs) -> {files}`),
 * so the sentence describing it to the model belongs in one place too -- it was
 * byte-identical in NodeEditor.tsx and GuiWidgetEditor.tsx, which is exactly
 * how two copies of a prompt start drifting.
 */
export const SELECTOR_CODE_CONTEXT =
  '`inputs["files"]` is the full list of rooted file paths found in the directory. ' +
  'Return only the selected paths as {"files": [...]}.';

/**
 * The plot_window widget's data-transform contract (same as a Code node).
 *
 * The chart itself is drawn by the app (`PlotWidget.tsx`, a dependency-free
 * SVG renderer), so the transform must NOT plot anything — it only reshapes
 * the incoming value into the points PlotWidget understands. Spelling that
 * out matters: without it, models reliably reach for matplotlib, which isn't
 * installed in the sandbox and whose figures aren't JSON-serializable anyway.
 */
export const PLOT_TRANSFORM_CONTEXT =
  'Must expose run(inputs: dict) -> dict, receiving {"value": <raw incoming data>} ' +
  'and returning {"value": <plot-ready data>}. Plot-ready data is a JSON-serializable ' +
  'list of points: either a list of numbers, or a list of {"label": str, "value": number} ' +
  'objects. The app renders these itself as an SVG bar/line chart — do NOT draw anything ' +
  'and do NOT import plotting or third-party libraries (no matplotlib, plotly, pandas, ' +
  'numpy): the code runs in a sandbox with only the standard library available.';

/**
 * What the ✨ Generate buttons tell the AI about the world around a node.
 *
 * A node's own description says what the user wants; these say what the node is
 * actually wired to and what really flowed through it. Without them a model has
 * to guess the shape of its inputs, and a small local model guesses badly.
 *
 * Two independent sources, both optional and both cheap:
 *
 *  - `connectedFormatContext` — the *declared* contracts of the neighbours, from
 *    the graph itself.
 *  - `lastRunContext` — the *observed* values from the most recent run. Run once,
 *    then generate, and the model sees real data instead of a description of it.
 */

/** How many characters of a sampled value to include before truncating. */
const SAMPLE_BUDGET = 1200;

/** What a node emits, in one line, for whichever node type it is. */
export function describeNodeOutput(node: GraphNode): string {
  switch (node.node_type) {
    case 'data':
      return describeDataFormat(node);
    case 'input': {
      const mode = node.config.input_mode ?? 'text';
      if (mode === 'directory') return 'a list of file paths';
      if (mode === 'file') return 'a file path';
      return 'text';
    }
    case 'ai':
    case 'code': {
      const format = node.config.output_format;
      if (!format || format === 'text') return 'text';
      const detail = format === 'custom' && node.config.output_format_prompt
        ? `: ${node.config.output_format_prompt}`
        : '';
      return `${format}${detail}`;
    }
    case 'gui':
      return 'values from its widgets';
    default:
      return '';
  }
}

/**
 * The declared contracts of everything wired directly to *nodeId*.
 *
 * This used to consider `data` nodes only, so a code node fed by a file input or
 * by another code node was generated with no idea what it would receive -- which
 * is most graphs.
 */
export function connectedFormatContext(
  nodeId: string,
  nodes: GraphNode[],
  edges: Array<{ source: string; target: string }>,
): string {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  // A Set, because two ports wired to the same neighbour are two edges but one
  // fact: repeating it only spends the model's attention on nothing.
  const lines = new Set<string>();

  for (const edge of edges) {
    if (edge.target === nodeId) {
      const source = nodeById.get(edge.source);
      if (!source) continue;
      const described = describeNodeOutput(source);
      if (!described) continue;
      // The wording for a data node is kept verbatim: it is the one contract a
      // user writes deliberately, and existing graphs' prompts were tuned to it.
      lines.add(source.node_type === 'data'
        ? `Source data format from "${source.label}": ${described}`
        : `Input from "${source.label}" (${source.node_type} node): ${described}`);
    }
    if (edge.source === nodeId) {
      const target = nodeById.get(edge.target);
      if (!target) continue;
      if (target.node_type === 'data') {
        lines.add(`Target data format required by "${target.label}": ${describeDataFormat(target)}`);
      } else {
        lines.add(`Output goes to "${target.label}" (${target.node_type} node).`);
      }
    }
  }
  return [...lines].join('\n');
}

function preview(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text === undefined) return String(value);
  return text.length > SAMPLE_BUDGET ? `${text.slice(0, SAMPLE_BUDGET)}\n… (truncated)` : text;
}

/**
 * What actually arrived on this node's input ports the last time the graph ran.
 *
 * The single most informative thing available, and it was going unused: the
 * store already holds it, and a description of a CSV is a poor substitute for
 * eight of its rows. Absent before the first run, which is exactly when there is
 * nothing to say.
 */
export function lastRunContext(nodeId: string, result: ExecutionResult | null): string {
  const nodeResult = result?.node_results?.find((r) => r.node_id === nodeId);
  const inputs = nodeResult?.inputs;
  if (!inputs || Object.keys(inputs).length === 0) return '';

  const lines = Object.entries(inputs).map(([port, value]) => {
    const shape = Array.isArray(value) ? `list of ${value.length}` : typeof value;
    return `- ${port} (${shape}):\n${preview(value)}`;
  });
  return `Actual values this node received on its last run -- generate against these, not against a guess:\n${lines.join('\n')}`;
}
