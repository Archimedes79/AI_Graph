import { useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import type { Graph } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { ApiError, call, watchGeneration, type AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import LiveGeneration from '@/authoring/LiveGeneration';
import GraphProblems from './GraphProblems';
import { lastAsked } from './Toolbar';
import { changeGoesTo, changeTarget, describeChange, graphChange, graphRequest, targetName } from './graphChange';
import { ACCENT_TEXT, DANGER_TEXT, DIM, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, SURFACE, TEXT } from '@/ui/theme';

/** Where a change of the whole graph stands: asked, back and waiting to be applied, failed, or applied. */
type Change =
  | { phase: 'idle' }
  | { phase: 'asking'; said: string; calls: AICall[] }
  /** *sent*: the graph as it was asked about, to tell whether it changed since. */
  | { phase: 'ready'; said: string; graph: Graph; explanation: string; sent: string }
  | { phase: 'failed'; said: string; error: string; calls: AICall[] }
  /** *step*: how many undo steps there were once it was applied -- while there still are, Undo is the change. */
  | { phase: 'applied'; step: number };

/**
 * The bar under the canvas, always there: say what to change, on the node the
 * person is on -- or, with none, on the whole graph.
 *
 * On a node whose body ✨ writes, the words go to the node's panel
 * (`askChange`), which changes the body as said. On the whole graph -- and on
 * a node whose settings are all it is, a change of that node in it -- ✨ AI
 * Graph is sent the graph and the words, and what comes back is shown, with
 * what it adds, removes and changes and what `check` finds in it, before it is
 * applied as one undo step.
 */
export default function ChangeBar() {
  const target = useGraphStore((s) => changeTarget(s.rfNodes.map((n) => n.data.graphNode), s.editingNodeId));
  const clearSelection = useGraphStore((s) => s.clearSelection);
  const steps = useGraphStore((s) => s.past.length);
  const [text, setText] = useState('');
  const [change, setChange] = useState<Change>({ phase: 'idle' });
  // Only the last change asked for is still wanted: Stop leaves the one on its way unwanted.
  const asked = useRef(lastAsked());

  const asking = change.phase === 'asking';

  const send = async () => {
    const words = text.trim();
    if (!words || asking) return;
    const store = useGraphStore.getState();
    if (target && changeGoesTo(target) === 'panel') {
      store.askChange(target.id, words);
      setText('');
      setChange({ phase: 'idle' });
      return;
    }
    const graph = store.exportGraph();
    const document = store.document;
    const wanted = asked.current.ask();
    setChange({ phase: 'asking', said: words, calls: [] });
    setText('');
    try {
      const result = await watchGeneration(
        (progressId) => call('generateGraph', { description: graphRequest(target, words), graph, progress_id: progressId }),
        (calls) => { if (wanted()) setChange((now) => (now.phase === 'asking' ? { ...now, calls } : now)); },
      );
      if (!wanted()) return;
      // Another graph is open now, or a level in or out of it: what came back is not its.
      if (useGraphStore.getState().document !== document) {
        setChange({ phase: 'idle' });
        return;
      }
      setChange({ phase: 'ready', said: words, graph: result.graph, explanation: result.explanation, sent: JSON.stringify(graph) });
    } catch (error) {
      if (!wanted()) return;
      // The words go back where they were, to be sent again or said otherwise.
      setText(words);
      setChange({
        phase: 'failed', said: words, error: errorText(error, 'The graph could not be changed.'),
        calls: error instanceof ApiError && error.body.calls ? error.body.calls : [],
      });
    }
  };

  const stop = () => {
    if (change.phase !== 'asking') return;
    asked.current.cancel();
    setText(change.said);
    setChange({ phase: 'idle' });
  };

  const apply = () => {
    if (change.phase !== 'ready') return;
    useGraphStore.getState().changeGraph(change.graph);
    setChange({ phase: 'applied', step: useGraphStore.getState().past.length });
  };

  const discard = () => {
    if (change.phase === 'ready') setText(change.said);
    setChange({ phase: 'idle' });
  };

  return (
    <div className="flex flex-col gap-2.5 px-4 pt-3 pb-3.5 shrink-0" style={{ background: SURFACE, borderTop: `1px solid ${LINE}` }}>
      {change.phase === 'asking' && (
        <Note>
          <div className="flex items-center gap-3">
            <span className="flex-1 min-w-0 truncate" style={{ color: TEXT }} title={change.said}>✨ Changing the graph as said: {change.said}</span>
            <button type="button" onClick={stop} className="shrink-0 rounded-lg px-3 py-1 text-xs" style={NEUTRAL_BUTTON}>Stop</button>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer select-none text-xs" style={{ color: MUTED }}>What is sent, and what comes back</summary>
            <div className="mt-2"><LiveGeneration calls={change.calls} minHeight={90} /></div>
          </details>
        </Note>
      )}
      {change.phase === 'ready' && <Proposal change={change} onApply={apply} onDiscard={discard} />}
      {change.phase === 'failed' && (
        <Note>
          <div className="flex items-start gap-3">
            <span className="flex-1 min-w-0" style={{ color: DANGER_TEXT }}>❌ {change.error}</span>
            <button type="button" onClick={() => setChange({ phase: 'idle' })} className="shrink-0 text-xs" style={{ color: MUTED }} aria-label="Dismiss">✕</button>
          </div>
          {change.calls.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs" style={{ color: MUTED }}>What was sent, and what came back</summary>
              <div className="mt-2"><LiveGeneration calls={change.calls} minHeight={90} /></div>
            </details>
          )}
        </Note>
      )}
      {change.phase === 'applied' && steps === change.step && (
        <Note>
          <div className="flex items-center gap-3">
            <span className="flex-1 min-w-0" style={{ color: TEXT }}>✓ The graph was changed as said.</span>
            <button type="button" onClick={() => useGraphStore.getState().undo()} className="shrink-0 rounded-lg px-3 py-1 text-xs" style={NEUTRAL_BUTTON}>
              ↶ Undo
            </button>
            <button type="button" onClick={() => setChange({ phase: 'idle' })} className="shrink-0 text-xs" style={{ color: MUTED }} aria-label="Dismiss">✕</button>
          </div>
        </Note>
      )}

      <div className="flex items-center gap-2.5 min-w-0">
        <button
          type="button"
          onClick={clearSelection}
          disabled={!target}
          className="h-10 shrink-0 max-w-[40%] truncate rounded-lg px-3 text-sm"
          style={{ background: SUNKEN, border: `1px solid ${LINE}`, color: TEXT, cursor: target ? 'pointer' : 'default' }}
          title={target ? 'Say it about the whole graph instead' : 'Nothing is selected: what you say changes the graph itself'}
        >
          on: {targetName(target)}
        </button>
        <label
          className="flex h-10 flex-1 min-w-0 items-center gap-2.5 rounded-lg px-3"
          style={{ background: SUNKEN, border: `1px solid ${LINE}` }}
        >
          <Sparkles size={14} strokeWidth={2} aria-hidden="true" style={{ color: ACCENT_TEXT, flexShrink: 0 }} />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void send();
            }}
            disabled={asking}
            placeholder="Say what to change…"
            aria-label="Say what to change"
            className="flex-1 min-w-0 bg-transparent text-sm outline-none"
            style={{ color: TEXT }}
          />
        </label>
        <button
          type="button"
          onClick={() => { void send(); }}
          disabled={asking || !text.trim()}
          className="h-10 shrink-0 rounded-lg px-4 text-sm font-semibold"
          style={{ ...PRIMARY_BUTTON, opacity: asking || !text.trim() ? 0.55 : 1 }}
          title={target && changeGoesTo(target) === 'panel'
            ? `Change ${targetName(target)} as said: its panel writes it, and tries it`
            : 'Ask ✨ AI Graph to change the graph as said: you see what it changes before it is applied'}
        >
          Change
        </button>
      </div>
    </div>
  );
}

/** A box over the bar's row: what a change of the whole graph is doing, or came to. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg px-3.5 py-2.5 text-sm" style={{ background: SUNKEN, border: `1px solid ${LINE}` }} role="status">
      {children}
    </div>
  );
}

/**
 * The graph ✨ changed, before it is applied: what it says about it, what it
 * adds, removes and changes, what `check` finds in it -- and, when the graph
 * was changed here while it was asked, that applying it replaces that.
 */
function Proposal({ change, onApply, onDiscard }: {
  change: Extract<Change, { phase: 'ready' }>;
  onApply: () => void;
  onDiscard: () => void;
}) {
  // Drawn anew whenever the graph changes, and the graph read as it is then:
  // what the change is measured against.
  useGraphStore((s) => s.rfNodes);
  useGraphStore((s) => s.rfEdges);
  useGraphStore((s) => s.metadata);
  const now = useGraphStore.getState().exportGraph();
  const lines = describeChange(graphChange(now, change.graph));
  const movedOn = JSON.stringify(now) !== change.sent;
  return (
    <Note>
      <div className="max-h-[38vh] overflow-y-auto flex flex-col gap-2">
        <p style={{ color: TEXT }}>{change.explanation || 'The graph, changed as said.'}</p>
        <ul className="text-xs flex flex-col gap-0.5" style={{ color: MUTED }}>
          {lines.map((line) => (
            <li key={line} style={line.startsWith('Removes') ? { color: DANGER_TEXT } : undefined}>{line}</li>
          ))}
        </ul>
        {movedOn && (
          <p className="text-xs" style={{ color: DANGER_TEXT }}>
            The graph was changed here since this was asked: applying it replaces those changes. Undo takes it back.
          </p>
        )}
        <GraphProblems graph={change.graph} action="Apply" />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-xs" style={{ color: DIM }} title={change.said}>Asked: {change.said}</span>
        <button type="button" onClick={onDiscard} className="shrink-0 rounded-lg px-3 py-1.5 text-xs" style={NEUTRAL_BUTTON}>Discard</button>
        <button type="button" onClick={onApply} className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold" style={PRIMARY_BUTTON}>
          Apply
        </button>
      </div>
    </Note>
  );
}
