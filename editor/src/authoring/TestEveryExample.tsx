import { useState } from 'react';
import type { Graph } from '@/graph';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { ExampleResult } from '@engine/execution/examples.ts';
import { DANGER_TEXT, DIMMER, MUTED, NEUTRAL_BUTTON, SUCCESS, TEXT } from '@/ui/theme';

const MARK: Record<ExampleResult['status'], { sign: string; color: string }> = {
  pass: { sign: '✓', color: SUCCESS },
  fail: { sign: '✗', color: DANGER_TEXT },
  error: { sign: '✗', color: DANGER_TEXT },
  skipped: { sign: '·', color: DIMMER },
};

interface Props {
  /** The graph with the node as the dialog holds it: what is tested is the edit. */
  graph: () => Graph;
  nodeId: string;
  /** How many examples its `examples.md` holds. */
  count: number;
}

/**
 * Every example of the node run as `test` runs them -- a judge asked, the
 * examples after the first run too -- for what ▶ Try it cannot say: it runs
 * the first example and compares it with step 2, and a judge's sentence is
 * held by a model. The dialog shows this only where a file holds such checks;
 * otherwise Try it says all of it.
 */
export default function TestEveryExample({ graph, nodeId, count }: Props) {
  const [results, setResults] = useState<ExampleResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState('');

  const run = async () => {
    setRunning(true); setFailure(''); setResults(null);
    try {
      setResults((await call('testNode', { ...graph(), node_id: nodeId })).results);
    } catch (error) {
      setFailure(errorText(error, 'The examples could not be run.'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-1">
      <button className="text-xs px-2 py-1 rounded" style={{ ...NEUTRAL_BUTTON, opacity: running ? 0.5 : 1 }}
        disabled={running} onClick={run}
        title="Run the node on each example in its examples.md and check each, the way test does -- a model is asked where one judges">
        {running ? 'Testing…' : count > 1 ? `▶ Test all ${count} examples` : '▶ Test the example, judge included'}
      </button>
      {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
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
    </div>
  );
}
