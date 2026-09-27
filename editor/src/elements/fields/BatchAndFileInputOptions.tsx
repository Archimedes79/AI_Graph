import type { GraphNode } from '@/graph';
import { DIMMER, FIELD, MUTED } from '@/ui/theme';

interface Props {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  /** What the node runs, for the help text: "this prompt" vs "this code". */
  subject: 'prompt' | 'code';
}

/**
 * The execution switches every runnable node has, folded away: what a failure
 * costs, whether `file_path` inputs are read from disk first, and how many
 * items of a list run at once.
 *
 * They mean the same thing for an AI node and a Code node -- `catch_errors`,
 * `read_file_inputs` and `batch_concurrency` are handled by the executor, not
 * by the element -- so the controls and their explanations live once, here.
 * Whether a list is taken item by item is not among them: it is a question
 * about what comes in, asked in step 1 ("Run once per item").
 */
export default function BatchAndFileInputOptions({ node, setConfig, subject }: Props) {
  return (
    <>
      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={node.config.catch_errors === true}
            onChange={(e) => setConfig('catch_errors', e.target.checked)}
          />
          Catch failures instead of ending the run
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Off, a failure in {subject === 'code' ? 'this code' : 'this prompt'} stops the run and
          everything downstream is skipped. On, this node grows an{' '}
          <strong style={{ color: '#a78bfa' }}>Error</strong> output carrying the reason, its
          other outputs carry nothing, and the run goes on. Wiring that output is optional —
          leave it unconnected and the run simply continues.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={!!node.config.read_file_inputs}
            onChange={(e) => setConfig('read_file_inputs', e.target.checked)}
          />
          Read file contents from paths
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          When on, an input that receives a file path -- typed &lsquo;File path&rsquo;, or wired from something
          that hands on paths -- is read from disk (text or base64) before this node runs, and the example
          in step 1 is read the same way.
        </p>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          Items at once
          <input
            type="number"
            min={0}
            className="w-20 rounded px-2 py-1 text-sm"
            style={FIELD}
            value={Number(node.config.batch_concurrency ?? 0)}
            onChange={(e) => setConfig('batch_concurrency', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            aria-label="Items at once"
          />
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          When it runs once per item: how many items run at the same time. 0 is the default, four.
        </p>
      </div>
    </>
  );
}
