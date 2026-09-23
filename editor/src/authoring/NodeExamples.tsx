import { useState } from 'react';
import type { ExecutionResult, GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import { formatExample, type ExampleResult } from '@engine/execution/examples.ts';
import CodeField from './CodeField';
import { DANGER_TEXT, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUCCESS, TEXT } from '@/ui/theme';

interface NodeExamplesProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  executionResult: ExecutionResult | null;
}

/**
 * An example to start from, keyed by *this* node's ports. It was always
 * `input` and `output`, which a node with `csv` and `rows` would have to
 * rename before the example checked anything.
 */
function template(node: GraphNode): string {
  const keyed = (ids: string[], fallback: string) =>
    `{ ${(ids.length ? ids : [fallback]).map((id) => `"${id}": "…"`).join(', ')} }`;
  const inputs = keyed(node.inputs.map((port) => port.id), 'input');
  const outputs = keyed(node.outputs.filter((port) => port.id !== 'error').map((port) => port.id), 'output');
  return `## What this example shows\n\n\`\`\`json input\n${inputs}\n\`\`\`\n\n\`\`\`json expect\n${outputs}\n\`\`\`\n`;
}

const MARK: Record<ExampleResult['status'], { sign: string; color: string }> = {
  pass: { sign: '✓', color: SUCCESS },
  fail: { sign: '✗', color: DANGER_TEXT },
  error: { sign: '✗', color: DANGER_TEXT },
  skipped: { sign: '·', color: DIMMER },
};

/**
 * A node's examples: inputs, and what must come out -- `examples.md` in a
 * project. Optional, and nothing else reads them to write code: they check
 * what was written, whoever wrote it. The fastest way to one is a run that
 * came out right: "Add from last run" writes down what went in and came out.
 */
export default function NodeExamples({ node, setConfig, executionResult }: NodeExamplesProps) {
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const [results, setResults] = useState<ExampleResult[] | null>(null);
  const [note, setNote] = useState('');
  const [running, setRunning] = useState(false);
  const text = String(node.config.examples ?? '');
  const ran = executionResult?.node_results.find((r) => r.node_id === node.id && r.status === 'success');

  const addFromRun = () => {
    if (!ran) {
      setNote('Run the graph first: an example is taken from a run of this node that succeeded.');
      return;
    }
    const example = formatExample('From a run', ran.inputs, ran.outputs);
    setConfig('examples', text.trim() ? `${text.trimEnd()}\n\n${example}` : example);
    setNote('Added what the last run gave this node and what it returned. Keep only the fields that matter under expect.');
  };

  const runAll = async () => {
    setRunning(true);
    setNote('');
    try {
      // The node as it stands in the dialog, not as it was saved: the point is to test the edit.
      const graph = exportGraph();
      graph.nodes = graph.nodes.map((n) => (n.id === node.id ? node : n));
      setResults((await call('testNode', { ...graph, node_id: node.id })).results);
    } catch (error) {
      setNote(errorText(error, 'Could not run the examples.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <details className="rounded-lg" open={!!text.trim()} style={{ border: `1px solid ${LINE}` }}>
      <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
        Examples — inputs, and what must come out (optional; ✨ Generate writes to satisfy them)
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2">
        <div className="flex items-center gap-2 justify-end">
          <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON} onClick={addFromRun}
            title="Write down what the last run gave this node and what it returned">
            + Add from last run
          </button>
          <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: text.trim() && !running ? 1 : 0.5 }}
            disabled={!text.trim() || running} onClick={runAll} title="Run this node on each example's inputs">
            {running ? 'Running…' : '▶ Run examples'}
          </button>
        </div>
        {/* Above the text, where the button that produced them is: the text can be long. */}
        {results && (
          <ul className="text-xs space-y-1" aria-label="Example results">
            {results.map((result, index) => (
              <li key={index}>
                <span style={{ color: MARK[result.status].color }}>{MARK[result.status].sign} </span>
                <span style={{ color: TEXT }}>{result.title}</span>
                {result.status === 'skipped' && <span style={{ color: DIMMER }}> — skipped</span>}
                {result.details.map((line, at) => <div key={at} className="pl-4" style={{ color: MUTED }}>{line}</div>)}
              </li>
            ))}
            {!results.length && <li style={{ color: DIMMER }}>No example could be read.</li>}
          </ul>
        )}
        <CodeField
          value={text}
          onChange={(next) => setConfig('examples', next)}
          language="markdown"
          placeholder={template(node)}
          minHeight={120}
          title={`${node.label} — examples`}
        />
        <p className="text-xs" style={{ color: DIMMER }}>
          Each <code>## title</code> is one example: a <code>```json input</code> block keyed by input port, and a
          {' '}<code>```json expect</code> block with the outputs that must match (only those fields are compared) — or, for
          an answer that is never the same twice, a <code>```judge</code> block with a sentence a model holds it to.
        </p>
        {note && <p className="text-xs" style={{ color: MUTED }}>{note}</p>}
      </div>
    </details>
  );
}
