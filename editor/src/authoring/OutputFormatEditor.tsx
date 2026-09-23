import type React from 'react';
import type { ExecutionResult, GraphNode } from '@/graph';
import { describeDataFormat } from '@/elements/nodes/data/dataFormat';
import { NODE_BUILDERS } from '@/elements/registry';
import { outputExampleText, outputFormatText } from './outputFormat';
import { ACCENT_TEXT, DIM, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, SUCCESS } from '@/ui/theme';

interface Props {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  /** Data node(s) directly wired to this node's output, if any (see connectedOutputDataNodes). */
  connectedDataNodes?: GraphNode[];
  /** For "use the last result": what this node returned when the graph last ran. */
  executionResult?: ExecutionResult | null;
  /** Drawn under the format: the shape a run kept (`OutputInterface`), the same question answered by measuring. */
  children?: React.ReactNode;
}

/**
 * What the output looks like: said in words, and shown by an example if there
 * is one. Both are sent -- to ✨ Generate for this node and for the nodes it
 * feeds, and to an ai node's model on every run -- whenever they say anything.
 *
 * There used to be a choice of six formats in front of these. Five of them
 * said less than a sentence does ("JSON" -- of what?), and picking one of
 * them meant the sentence written under it was kept, shown, and sent to no
 * model at all. A format picked in an older version is shown in front of the
 * words (`outputFormatText`), so it is still what is sent.
 *
 * Its own ✨ button went too: it wrote this description from the node's
 * request, which ✨ Generate for the body is told anyway.
 */
export default function OutputFormatEditor({ node, setConfig, connectedDataNodes = [], executionResult, children }: Props) {
  const element = NODE_BUILDERS[node.node_type];
  const words = outputFormatText(node.config);
  const example = outputExampleText(node.config);
  const ran = executionResult?.node_results.find((r) => r.node_id === node.id && r.status === 'success');

  const setWords = (text: string) => {
    setConfig('output_format', 'custom');
    setConfig('output_format_prompt', text);
  };

  // A downstream Data node already says what shape this node's output must
  // have: taken over in one click, rather than written a second time.
  const applyDataNodeFormat = (dataNode: GraphNode) => {
    setWords(dataNode.config.data_format === 'structure' ? (dataNode.config.data_format_prompt ?? '') : 'Plain text.');
  };

  /** What this node returned last run, as an example to follow. An ai node's is its answer. */
  const lastResult = (): string => {
    const outputs = ran?.outputs ?? {};
    const own = Object.fromEntries(Object.entries(outputs).filter(([port]) => port !== 'error'));
    const values = Object.values(own);
    if (values.length === 1 && typeof values[0] === 'string') return values[0];
    return JSON.stringify(values.length === 1 ? values[0] : own, null, 2);
  };

  return (
    <div className="space-y-3">
      {connectedDataNodes.map((dataNode) => (
        <div
          key={dataNode.id}
          className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-3"
          style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: MUTED }}
        >
          <span>
            Wired to data node <strong style={{ color: ACCENT_TEXT }}>"{dataNode.label}"</strong>, which stores:{' '}
            <em>{describeDataFormat(dataNode)}</em>
          </span>
          <button
            onClick={() => applyDataNodeFormat(dataNode)}
            className="shrink-0 text-xs px-2 py-1 rounded"
            style={{ background: SUCCESS, color: 'white' }}
          >
            Use this format
          </button>
        </div>
      ))}

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }} htmlFor={`format-${node.id}`}>
          {element.outputFormatLabel}
        </label>
        <p className="text-xs mb-1.5" style={{ color: DIM }}>{element.outputFormatHint}</p>
        <textarea
          id={`format-${node.id}`}
          className="w-full rounded-lg px-2 py-1.5 text-sm resize-y"
          style={{ ...FIELD, minHeight: 64 }}
          value={words}
          onChange={(e) => setWords(e.target.value)}
          placeholder="In words — e.g. “A JSON list of {title, score}, best first” or “Two sentences, no heading”. Empty: plain text."
        />
      </div>

      <details open={!!example}>
        <summary className="text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
          Example of the output (optional) — the same structure, new content each time
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <textarea
            className="w-full rounded-lg px-2 py-1.5 text-sm font-mono resize-y"
            style={{ ...FIELD, minHeight: 64 }}
            value={example}
            onChange={(e) => setConfig('output_example', e.target.value)}
            placeholder="Paste a result you liked, or take the last one."
            spellCheck={false}
            aria-label="Example of the output"
          />
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-2 py-1 rounded"
              style={{ ...NEUTRAL_BUTTON, opacity: ran ? 1 : 0.5 }}
              disabled={!ran}
              onClick={() => setConfig('output_example', lastResult())}
              title={ran ? 'Keep what this node returned on the last run as the example' : 'Run the graph first'}
            >
              Use the last result
            </button>
            {example && (
              <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON} onClick={() => setConfig('output_example', '')}>
                Clear
              </button>
            )}
          </div>
          <p className="text-xs" style={{ color: DIMMER }}>
            Easier than describing a format: run the node once, and if the result has the shape you want, keep it.
          </p>
        </div>
      </details>

      {children}
    </div>
  );
}
