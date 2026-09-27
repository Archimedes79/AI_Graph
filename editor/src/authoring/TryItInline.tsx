import React, { useState } from 'react';
import type { Graph, GraphNode } from '@/graph';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { ExampleResult } from '@engine/execution/examples.ts';
import type { ExamplePair } from './examplePair';
import { othersLine } from './nodeStepRules';
import { ACCENT_TEXT, DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUCCESS, SUNKEN, TEXT } from '@/ui/theme';

/** What trying a node gave. */
export interface TryResult {
  status: string;
  /** Its outputs, per port. */
  outputs?: Record<string, unknown>;
  error?: string | null;
  messages?: string[];
}

/** What one press of ▶ Try it came to. */
export interface Tried {
  result?: TryResult;
  /** It could not be tried at all: why. */
  failure?: string;
  /** The model's word on the answer, where the example is judged: '' when it meets the sentence, else why not. */
  judged?: string;
  /**
   * Why the model that judges could not be asked, where it could not: the
   * answer stands, unjudged. Not the node failing, and nothing to fix.
   */
  unjudged?: string;
  /** The examples after the first, as `test` ran them beside it. */
  others?: ExampleResult[];
  /**
   * What the judge's word and `others` speak of: the judge's sentence, and
   * the examples after the first, as they were when ▶ was pressed. Neither is
   * the node, so a try stays when they change -- and those words go
   * (`stillSaid`).
   */
  of?: { judge: string; later: string };
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

/**
 * What a try gave, while it is a try of what would be tried now (*now*), and
 * null once the body, the settings or the example moved on: "Keep" and ✓ must
 * describe what is there, not what was there when ▶ was pressed.
 */
export function currentTry<T>(held: { of: string; value: T } | null, now: string): T | null {
  return held && held.of === now ? held.value : null;
}

/**
 * *tried*, saying only what is still true of the examples as they are now
 * (*pair*): the judge's word while its sentence is the one it judged by, how
 * the other examples did while they are the ones that ran. What came out stays,
 * a try of the node as it is (`tryKey`): "✓ Judged by a model: it meets this"
 * stood under a sentence the model had never seen, and ✨ Fix was told it.
 */
export function stillSaid(tried: Tried | null, pair: ExamplePair): Tried | null {
  if (!tried?.of) return tried;
  const judge = tried.of.judge === (pair.judge ?? '');
  const later = tried.of.later === pair.later;
  if (judge && later) return tried;
  const { judged, unjudged, others, ...rest } = tried;
  return {
    ...rest,
    ...(judge && judged !== undefined ? { judged } : {}),
    ...(judge && unjudged ? { unjudged } : {}),
    ...(later && others ? { others } : {}),
  };
}

/**
 * A try made the way `test` runs a node's examples (`testNode`): the first is
 * step 1's example, so what came out is its outputs and the judge's word is
 * on that answer; the rest are the other examples -- those of *pair*, which
 * the try speaks of (`stillSaid`). A broken output interface is said beside
 * what came out, as a run says it. A judge that could not be asked is said
 * as that (`unjudged`): read as the node failing, it offered ✨ Fix to rewrite
 * a body that works because a model was busy.
 */
export function triedFromExamples(results: ExampleResult[], pair: ExamplePair): Tried {
  const [first, ...others] = results;
  if (!first) return { failure: 'Its examples.md holds no example that can be run.' };
  const failed = first.status === 'error' && !first.judgeError;
  const verdict = first.details.find((line) => line.startsWith('judged: '));
  return {
    result: {
      status: failed ? 'error' : 'success',
      outputs: first.outputs ?? {},
      error: failed ? first.details.join('\n') : null,
      messages: first.details.filter((line) => line.startsWith('breaks its output interface')),
    },
    ...(pair.judge && !failed
      ? first.judgeError ? { unjudged: first.judgeError } : { judged: verdict ? verdict.slice('judged: '.length) : '' }
      : {}),
    others,
    of: { judge: pair.judge ?? '', later: pair.later },
  };
}

/**
 * ▶ Try it: *node* alone on step 1's example (*inputs*), in *graph* -- the
 * dialog's node in the canvas's graph. As a run runs it (`runNode`); or,
 * where its examples hold more than a try can check by itself -- a judge's
 * sentence, more examples -- as `test` runs them all (`testNode`), whose
 * first is this one, so that the answer shown is the answer judged.
 */
export async function tryNode(graph: Graph, node: GraphNode, inputs: Record<string, unknown>, pair: ExamplePair): Promise<Tried> {
  if (pair.complete && (!!pair.judge || pair.others > 0)) {
    return triedFromExamples((await call('testNode', { ...graph, node_id: node.id })).results, pair);
  }
  return { result: await call('runNode', { ...graph, node_id: node.id, inputs }) };
}

/**
 * ▶ Try it's state: busy or not, and what the last press gave while it is a
 * try of *of* (`tryKey`) -- what would be tried now.
 */
export function useTry(of: string, run: () => Promise<Tried>): { busy: boolean; tried: Tried | null; start: () => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ of: string; value: Tried } | null>(null);
  const start = async () => {
    // What is tried is what is there as ▶ is pressed; an edit made while it
    // runs makes what comes back a try of something else.
    const tried = of;
    setBusy(true); setHeld(null);
    try {
      setHeld({ of: tried, value: await run() });
    } catch (error) {
      setHeld({ of: tried, value: { failure: errorText(error, 'It could not be tried.') } });
    } finally {
      setBusy(false);
    }
  };
  return { busy, tried: currentTry(held, of), start };
}

/**
 * What can be done about what came out, in few clicks: ✨ Fix where it failed
 * -- the body repaired from how it failed, the input it failed on and the body
 * as it is -- and "Say what to change": a sentence, Enter, and ✨ changes the
 * task and the body together from the body there is, what came of it and the
 * sentence; what it wrote is tried at once, and one Undo takes it back.
 */
export function ChangeIt({ busy, fix, failure, onSay, body }: {
  busy: boolean;
  /** ✨ Fix, where something failed. */
  fix?: () => void;
  /** Where it failed, when that is not the try on screen: the last run's error. */
  failure?: string;
  /** Asks for the change; resolves to whether it was made. */
  onSay: (change: string) => Promise<boolean>;
  /** What the body is called: "the code", "the instructions". */
  body: string;
}) {
  const [said, setSaid] = useState('');
  const say = async () => {
    if (!said.trim() || busy) return;
    if (await onSay(said.trim())) setSaid('');
  };
  return (
    <div className="space-y-2">
      {failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>The last run failed here: {clip(failure, 300)}</p>}
      {fix && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="text-xs px-2 py-1 rounded" style={{ background: SUCCESS, color: 'white', opacity: busy ? 0.5 : 1 }}
            disabled={busy} onClick={fix} title={`Repair ${body} from how it failed, the input it failed on and ${body} as it is`}>
            ✨ Fix
          </button>
          <span className="text-xs" style={{ color: DIMMER }}>From how it failed, the input and {body}.</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs whitespace-nowrap" style={{ color: MUTED }} htmlFor="say-what-to-change">Say what to change</label>
        <input
          id="say-what-to-change"
          className="flex-1 min-w-0 rounded px-2 py-1 text-xs"
          style={{ ...FIELD, opacity: busy ? 0.6 : 1 }}
          value={said}
          disabled={busy}
          onChange={(event) => setSaid(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void say(); } }}
          placeholder={`e.g. “Also count the words” -- Enter: ✨ changes the task and ${body} together, and tries it`}
          aria-label="Say what to change"
        />
      </div>
    </div>
  );
}

interface Props {
  /** Step 1 holds an example to run on. */
  canRun: boolean;
  /** Why it cannot run, when it cannot. */
  whyNot?: string;
  busy: boolean;
  onTry: () => void;
  /** What the last press gave, while it is a try of what is there now (`useTry`). */
  tried: Tried | null;
  /**
   * Where what came out falls short of the example's expected output, one line
   * each; empty when it meets it, undefined when nothing is expected or nothing
   * came out.
   */
  gaps?: string[];
  /** The expected output the example keeps, to see and to drop; absent while it keeps none. */
  expected?: { text: string; onForget: () => void; note?: React.ReactNode };
  /** "Keep as expected output", and what it does for this node, in a sentence. */
  keep?: { onKeep: (result: TryResult) => void; says: string };
  /** What came out, drawn the element's own way. Default: each output, as JSON. */
  renderResult?: (result: TryResult) => React.ReactNode;
  /** The sentence a model judges the answer by: its field, drawn under the verdict. */
  judge?: React.ReactNode;
  /** Drawn at the end: what can be done about what came out. */
  after?: React.ReactNode;
  /** Drawn above the button: an ai node's request, as the model will receive it. */
  children?: React.ReactNode;
}

/**
 * ▶ Try it, right under the body it tries: the element run by itself on step
 * 1's example, the way a run runs it -- per item when step 1 says so, files
 * read as a run reads them -- and everything said about what came out, in one
 * place: whether it gives the expected output, "Keep as expected output", the
 * judge's word, and how the other examples in examples.md did. Those used to
 * be step 2's -- an example output box, a judge, an example answer and a
 * ▶ Test of their own -- while what they were about showed down here.
 */
export default function TryItInline({ canRun, whyNot, busy, onTry, tried, gaps, expected, keep, renderResult, judge, after, children }: Props) {
  const { result = null, failure = '', judged, unjudged, others } = tried ?? {};
  const ran = !!result && result.status !== 'error' && result.status !== 'skipped';
  const more = others?.length ? othersLine(others) : '';

  return (
    <div className="space-y-2" aria-label="Try it">
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onTry}
          disabled={busy || !canRun}
          className="text-xs px-3 py-1 rounded"
          style={{ ...PRIMARY_BUTTON, opacity: busy || !canRun ? 0.5 : 1 }}
          title={canRun ? 'Run it by itself on the example in step 1 -- nothing downstream runs' : whyNot}
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
          {ran && !!result.messages?.length && <p className="text-xs mt-1" style={{ color: DIMMER }}>{result.messages.join(' ')}</p>}
          {ran && gaps && (
            <p className="text-xs mt-1" style={{ color: gaps.length ? DANGER_TEXT : SUCCESS }}>
              {gaps.length ? `✗ Not the expected output: ${gaps.join('; ')}` : '✓ It gives the expected output.'}
            </p>
          )}
        </div>
      )}

      {(expected || (ran && keep)) && (
        <div className="flex flex-wrap items-start gap-2">
          {expected && (
            <div className="text-xs flex-1 min-w-0 flex items-start gap-1.5" style={{ color: DIMMER }}>
              <span className="flex-1 min-w-0">
                Expected: <code>{clip(expected.text.trim(), 200)}</code>
                {expected.note}
              </span>
              <button className="text-xs px-1 rounded flex-shrink-0" style={NEUTRAL_BUTTON}
                aria-label="Drop the expected output" title="Expect nothing but that it runs"
                onClick={expected.onForget}>
                ✕
              </button>
            </div>
          )}
          {ran && keep && (
            <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} title={keep.says}
              onClick={() => keep.onKeep(result)}>
              Keep as expected output
            </button>
          )}
        </div>
      )}

      {judge}
      {judged !== undefined && (
        <p className="text-xs" style={{ color: judged ? DANGER_TEXT : SUCCESS }}>
          {judged ? `✗ Judged by a model: ${judged}` : '✓ Judged by a model: it meets this.'}
        </p>
      )}
      {unjudged && (
        <p className="text-xs" style={{ color: DANGER_TEXT }}>
          Not judged: the model that judges could not be asked -- {unjudged}
        </p>
      )}
      {more && <p className="text-xs" style={{ color: others?.every((one) => one.status === 'pass') ? SUCCESS : DANGER_TEXT }}>{more}</p>}
      {after}
    </div>
  );
}
