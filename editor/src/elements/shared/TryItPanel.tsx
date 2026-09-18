import React, { useState } from 'react';
import { errorText } from '../../utils/errorText';
import { tryValues, useTryValues } from './tryValues';
import { ACCENT_TEXT, DANGER_TEXT, DIM, DIMMER, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, TEXT } from '../../ui/theme';

export interface TryResult {
  status: string;
  /** A node's outputs, per port. */
  outputs?: Record<string, unknown>;
  /** A block's drawn value. */
  shown?: unknown;
  error?: string | null;
  messages?: string[];
}

interface Props {
  /** `nodeId`, or `nodeId::blockId`: what the values are filed under. */
  subject: string;
  title: string;
  ports: { id: string; name?: string }[];
  /** What the last run delivered, per port. */
  observed: Record<string, unknown>;
  /** Run what feeds this element and hand back what would arrive. */
  onFetch?: () => Promise<{ inputs: Record<string, unknown>; error: string | null }>;
  onTest: (values: Record<string, unknown>) => Promise<TryResult>;
  /** Drawn between the values and the result: an ai node's assembled request. */
  children?: React.ReactNode;
  /** The result, drawn the element's own way. Default: each output, as JSON. */
  renderResult?: (result: TryResult) => React.ReactNode;
  /** What ✨ Generate is told about the graph around this element. Shown, because it is sent. */
  context?: string;
  testLabel?: string;
}

/** Long values are shown by their ends: what matters here is that it is *that* value. */
export function clip(text: string, limit = 600): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit * 0.7)}\n  … ${text.length - limit} more characters …\n${text.slice(-limit * 0.3)}`;
}

export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * Trying an element out while writing it -- the same way for every element.
 *
 * An ai node, a code node and a chart's transform are the same loop: here is
 * what arrives, here is what I wrote, what comes out? It was built for the ai
 * node first and only there; a code node was tried by running the whole graph,
 * and a chart by running the graph and switching tabs to look.
 *
 * What differs is declared by the caller and nothing else: which ports, how to
 * run it, how to draw what came back. An ai node draws the request it
 * assembled in the middle; a chart draws the chart.
 *
 * The values are the ones ✨ Generate is shown (`tryValues.ts`), and the graph
 * context under "What ✨ is told" is the text that is sent with them -- both
 * visible, because a generation that goes wrong is usually one that was told
 * the wrong thing, and until now there was no way to see what it was told
 * before pressing the button.
 */
export default function TryItPanel({
  subject, title, ports, observed, onFetch, onTest, children, renderResult, context, testLabel,
}: Props) {
  const typed = useTryValues((state) => state.typed[subject]);
  const fetched = useTryValues((state) => state.fetched[subject]);
  const setTyped = useTryValues((state) => state.setTyped);
  const setFetched = useTryValues((state) => state.setFetched);
  const { values, source } = tryValues(subject, ports.map((port) => port.id), observed, {
    typed: { [subject]: typed ?? {} }, fetched: { [subject]: fetched ?? {} },
  });

  const [busy, setBusy] = useState<'' | 'test' | 'fetch'>('');
  const [result, setResult] = useState<TryResult | null>(null);
  const [failure, setFailure] = useState('');
  const hasValues = ports.length === 0 || ports.some((port) => values[port.id] !== undefined && values[port.id] !== '');

  const test = async () => {
    setBusy('test'); setFailure(''); setResult(null);
    try {
      setResult(await onTest(values));
    } catch (error) {
      setFailure(errorText(error, 'The test could not be run.'));
    } finally {
      setBusy('');
    }
  };

  const fetch = async () => {
    if (!onFetch) return;
    setBusy('fetch'); setFailure('');
    try {
      const got = await onFetch();
      setFetched(subject, got.inputs);
      if (got.error) setFailure(`Upstream: ${got.error}`);
      else if (!Object.keys(got.inputs).length) setFailure('Nothing is wired into this yet, so the graph has nothing to deliver here.');
    } catch (error) {
      setFailure(errorText(error, 'The graph could not be run up to here.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="rounded-lg" style={{ border: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
        <span className="text-xs font-medium flex-1" style={{ color: MUTED }}>{title}</span>
        {onFetch && (
          <button
            onClick={fetch}
            disabled={busy !== ''}
            className="text-xs px-2 py-1 rounded"
            style={{ ...NEUTRAL_BUTTON, opacity: busy ? 0.5 : 1 }}
            title="Run what feeds this — the file picked, the CSV parsed, the page's fields read — and put what would arrive here below. This element itself is not run."
          >
            {busy === 'fetch' ? 'Running upstream…' : '⟳ Inputs from the graph'}
          </button>
        )}
        <button
          onClick={test}
          disabled={busy !== '' || !hasValues}
          className="text-xs px-3 py-1 rounded"
          style={{ ...PRIMARY_BUTTON, opacity: busy || !hasValues ? 0.5 : 1 }}
          title={hasValues ? 'Run this alone, on the values below — nothing is saved, nothing downstream runs' : 'Type a value below, or get the inputs from the graph'}
        >
          {busy === 'test' ? 'Running…' : (testLabel ?? '▶ Test')}
        </button>
      </div>

      <div className="px-3 py-2 space-y-2">
        {ports.map((port) => (
          <div key={port.id} className="flex items-start gap-2">
            <code className="text-xs mt-1.5 flex-shrink-0 truncate" style={{ color: ACCENT_TEXT, width: 96 }} title={port.name || port.id}>
              {port.id}
            </code>
            <textarea
              className="flex-1 min-w-0 rounded px-2 py-1 text-xs font-mono resize-y"
              style={{ ...FIELD, minHeight: 28, height: 28 }}
              value={typed?.[port.id] ?? clip(asText(values[port.id]), 300)}
              onChange={(e) => setTyped(subject, port.id, e.target.value)}
              placeholder="a value to try it with — text, or JSON for a list or an object"
              aria-label={`Test value for ${port.id}`}
              spellCheck={false}
            />
            <span className="text-xs mt-1.5 flex-shrink-0" style={{ color: DIMMER, width: 52 }}>{source[port.id] ?? ''}</span>
          </div>
        ))}
        {ports.length === 0 && <p className="text-xs" style={{ color: DIMMER }}>This element has no inputs; it can be tried as it is.</p>}

        {children}

        {context && (
          <details>
            <summary className="text-xs cursor-pointer select-none" style={{ color: DIM }}>
              What ✨ Generate is told about the graph around this
            </summary>
            <pre className="text-xs rounded px-2 py-1.5 mt-1 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: MUTED, maxHeight: 200 }}>
              {context}
              {'\n\n'}— and the values above, as the sample the result is run against before you see it.
            </pre>
          </details>
        )}

        {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{failure}</p>}
        {result && (
          <div>
            <span className="text-xs font-medium" style={{ color: result.status === 'error' ? DANGER_TEXT : SUCCESS }}>
              {result.status === 'error' ? 'It failed' : result.status === 'skipped' ? 'It had nothing to do' : 'What came out'}
            </span>
            {result.status === 'error' || result.status === 'skipped' ? (
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
          </div>
        )}
      </div>
    </div>
  );
}
