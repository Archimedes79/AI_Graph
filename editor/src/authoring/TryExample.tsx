import { useState } from 'react';
import type { Graph, GraphNode } from '@/graph';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { ExampleRun } from '@engine/execution/examples.ts';
import type { Refine } from './generation';
import { ACCENT_TEXT, DANGER_TEXT, DIMMER, PRIMARY_BUTTON, SUCCESS, SUNKEN, TEXT } from '@/ui/theme';

/** What one press of ▶ Try came to: the example's run, or why it could not be tried. */
interface Tried {
  run?: ExampleRun;
  failure?: string;
}

/** Settings that do not change what a try runs: the ✨ prompts, the history, the files ✨ writes the definitions from. */
const NOT_RUN = new Set(['history', 'prompts', 'input_files', 'output_files']);

/**
 * What a try is a try of: the node as it runs -- its ports and its settings,
 * in one order -- so a try stays on screen while the text is edited, and goes
 * once the body, a definition or a port changes: ✓ must describe what is there.
 */
export function tryKey(node: GraphNode): string {
  const config = Object.entries(node.config as Record<string, unknown>)
    .filter(([key]) => !NOT_RUN.has(key)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([node.inputs, node.outputs, config]);
}

/** What came of a try, as "Say what to change" and ✨ Fix are asked with it -- or nothing, where nothing was tried. */
export function whatCameOf(tried: Tried | null): Omit<Refine, 'change'> | undefined {
  const run = tried?.run;
  if (!run || run.status === 'skipped') return tried?.failure ? { error: tried.failure } : undefined;
  if (run.status === 'error') return { error: run.details.join('\n') || 'It failed, and gave no reason.' };
  return { outcome: JSON.stringify(run.outputs ?? {}, null, 2), ...(run.details.length ? { problems: run.details } : {}) };
}

/** ▶ Try's state: what the last press gave, while it is a try of the node as it is now. */
export function useTryExample(node: GraphNode, graph: () => Graph): { tried: Tried | null; running: boolean; start: () => Promise<void> } {
  const [held, setHeld] = useState<{ of: string; tried: Tried } | null>(null);
  const [running, setRunning] = useState(false);
  const now = tryKey(node);
  const start = async () => {
    // What is tried is what is there as ▶ is pressed; an edit made while it
    // runs makes what comes back a try of something else.
    const of = now;
    setRunning(true);
    setHeld(null);
    try {
      setHeld({ of, tried: { run: await call('testNode', { ...graph(), node_id: node.id }) } });
    } catch (error) {
      setHeld({ of, tried: { failure: errorText(error, 'It could not be tried.') } });
    } finally {
      setRunning(false);
    }
  };
  return { tried: held?.of === now ? held.tried : null, running, start };
}

/**
 * What a try came to, in one line: ✓ only where it was held to an output.js
 * and fits it. A failure held to none is one whose output.js cannot be read --
 * its details say why -- and ✨ Fix (asked for it with the body) or ✨ Output
 * writes it again.
 */
export function triedLine(run: ExampleRun): string {
  if (run.status === 'pass') return run.held ? '✓ fits output.js' : 'It runs. There is no output.js yet to hold it to.';
  if (run.status === 'fail') {
    return run.held ? `✗ Does not fit output.js: ${run.details.join('; ')}` : `✗ ${run.details.join('; ')}. ✨ Fix or ✨ Output writes it again.`;
  }
  return run.status === 'skipped' ? run.details.join(' ') : `It failed: ${run.details.join('\n')}`;
}

const clip = (text: string, limit = 1500) => (text.length > limit ? `${text.slice(0, limit)}\n… ${text.length - limit} more characters` : text);
const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '');

/**
 * ▶ Try: one call of the node on the example in its input.js, the way `test`
 * runs it, and whether what came out fits its output.js -- ✓, or where it does
 * not. ✨ Fix repairs the body from that, where it failed or does not fit.
 */
export default function TryExample({ tried, running, onTry, whyNot, busy, onFix }: {
  tried: Tried | null;
  running: boolean;
  onTry: () => void;
  /** Why it cannot be tried yet; nothing when it can. */
  whyNot?: string;
  /** ✨ is writing: nothing is tried or fixed meanwhile. */
  busy: boolean;
  onFix: () => void;
}) {
  const run = tried?.run;
  const failed = !!tried?.failure || run?.status === 'error';
  const fixable = failed || run?.status === 'fail';
  return (
    <div className="space-y-2" aria-label="Try">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onTry}
          disabled={running || busy || !!whyNot}
          className="text-xs px-3 py-1 rounded"
          style={{ ...PRIMARY_BUTTON, opacity: running || busy || whyNot ? 0.5 : 1 }}
          title={whyNot ?? 'Run it once on the example in input.js, and hold what comes out to output.js -- nothing else runs'}
        >
          {running ? 'Running…' : '▶ Try'}
        </button>
        <span className="text-xs" style={{ color: DIMMER }}>{whyNot ?? 'On the example in input.js, held to output.js.'}</span>
        {fixable && (
          <button type="button" className="text-xs px-2 py-1 rounded" style={{ background: SUCCESS, color: 'white', opacity: busy ? 0.5 : 1 }}
            disabled={busy} onClick={onFix} title="Repair the body from how it failed, or where it does not fit output.js">
            ✨ Fix
          </button>
        )}
      </div>
      {tried?.failure && <p className="text-xs" style={{ color: DANGER_TEXT }}>{tried.failure}</p>}
      {run && run.status !== 'error' && Object.entries(run.outputs ?? {}).map(([port, value]) => (
        <div key={port}>
          <code className="text-xs" style={{ color: ACCENT_TEXT }}>{port}</code>
          <pre className="text-xs rounded px-2 py-1.5 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: TEXT, maxHeight: 200 }}>
            {clip(asText(value))}
          </pre>
        </div>
      ))}
      {run && (
        <p className="text-xs whitespace-pre-wrap" style={{ color: run.status === 'pass' ? SUCCESS : run.status === 'skipped' ? DIMMER : DANGER_TEXT }}>
          {triedLine(run)}
        </p>
      )}
    </div>
  );
}
