import React, { useState } from 'react';
import { errorText } from '@/api/errorText';
import { ownOutputs } from './nodeStepRules';
import { ACCENT_TEXT, DANGER_TEXT, DIMMER, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, TEXT } from '@/ui/theme';

/** What trying an element gave: a node's outputs, or what a block drew. */
export interface TryResult {
  status: string;
  /** A node's outputs, per port. */
  outputs?: Record<string, unknown>;
  /** A block's drawn value. */
  shown?: unknown;
  error?: string | null;
  messages?: string[];
}

/**
 * Long values are shown by their ends: what matters here is that it is *that*
 * value. Only for reading -- a box that can be edited holds the whole value,
 * or an edit stores the cut as the value.
 */
export function clip(text: string, limit = 600): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit * 0.7)}\n  … ${text.length - limit} more characters …\n${text.slice(-limit * 0.3)}`;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

interface Props {
  /** Step 1 holds an example to run on. */
  canRun: boolean;
  /** Why it cannot run, when it cannot. */
  whyNot?: string;
  /** Run the element as it stands in the dialog on step 1's example -- the executor's own path. */
  run: () => Promise<TryResult>;
  /**
   * Where what came out falls short of step 2's example output, one line each;
   * empty when it meets it, undefined when there is nothing to compare with.
   */
  verdict?: (outputs: Record<string, unknown>) => string[] | undefined;
  /** Keep what came out as step 2's example output. */
  onKeep?: (result: TryResult) => void;
  /** What came out, drawn the element's own way. Default: each output, as JSON. */
  renderResult?: (result: TryResult) => React.ReactNode;
  /** Drawn above the button: an ai node's request, as the model will receive it. */
  children?: React.ReactNode;
}

/**
 * ▶ Try it, right under the body it tries: the element run by itself on step
 * 1's example, the way a run runs it -- per item when step 1 says so, files
 * read as a run reads them -- and what came out, set against step 2's example
 * output. "Keep this result" makes what came out that example output.
 *
 * It used to be a fifth step with values of its own, kept in the browser and
 * nowhere else, a hint that promised to keep a result nothing could keep, and
 * an editable box that stored its clipped display text when it was edited.
 */
export default function TryItInline({ canRun, whyNot, run, verdict, onKeep, renderResult, children }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const [failure, setFailure] = useState('');
  const [kept, setKept] = useState(false);

  const test = async () => {
    setBusy(true); setFailure(''); setResult(null); setKept(false);
    try {
      setResult(await run());
    } catch (error) {
      setFailure(errorText(error, 'It could not be tried.'));
    } finally {
      setBusy(false);
    }
  };

  const ran = result && result.status !== 'error' && result.status !== 'skipped';
  const gaps = ran ? verdict?.(ownOutputs(result.outputs)) : undefined;

  return (
    <div className="space-y-2" aria-label="Try it">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={test}
          disabled={busy || !canRun}
          className="text-xs px-3 py-1 rounded"
          style={{ ...PRIMARY_BUTTON, opacity: busy || !canRun ? 0.5 : 1 }}
          title={canRun ? 'Run it by itself on the example in step 1 -- nothing is saved, nothing downstream runs' : whyNot}
        >
          {busy ? 'Running…' : '▶ Try it'}
        </button>
        <span className="text-xs" style={{ color: DIMMER }}>
          {canRun ? 'On the example in step 1, the way a run runs it.' : whyNot}
        </span>
      </div>

      {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
      {result && (
        <div>
          <span className="text-xs font-medium" style={{ color: result.status === 'error' ? DANGER_TEXT : SUCCESS }}>
            {result.status === 'error' ? 'It failed' : result.status === 'skipped' ? 'It had nothing to do' : 'What came out'}
          </span>
          {!ran ? (
            <pre className="text-xs rounded px-2 py-1.5 mt-1 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: result.status === 'error' ? DANGER_TEXT : MUTED, maxHeight: 200 }}>
              {result.error || result.messages?.join('\n') || 'No reason was given.'}
            </pre>
          ) : renderResult ? renderResult(result) : (
            Object.entries(result.outputs ?? {}).map(([port, value]) => (
              <div key={port} className="mt-1">
                <code className="text-xs" style={{ color: ACCENT_TEXT }}>{port}</code>
                <pre className="text-xs rounded px-2 py-1.5 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: TEXT, maxHeight: 200 }}>
                  {clip(asText(value), 1500)}
                </pre>
              </div>
            ))
          )}
          {ran && result.error && <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>{result.error}</p>}
          {gaps && (
            <p className="text-xs mt-1" style={{ color: gaps.length ? DANGER_TEXT : SUCCESS }}>
              {gaps.length ? `Not what step 2 expects: ${gaps.join('; ')}` : '✓ It gives what step 2 expects.'}
            </p>
          )}
          {ran && onKeep && (
            <div className="flex items-center gap-2 mt-1">
              <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON}
                onClick={() => { onKeep(result); setKept(true); }}
                title="Make what came out step 2's example output">
                Keep this result
              </button>
              {kept && <span className="text-xs" style={{ color: DIMMER }}>Kept as the example output in step 2.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
