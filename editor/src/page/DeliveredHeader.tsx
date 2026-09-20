import type { ReactNode } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { ACCENT, DANGER_TEXT, DIM, LINE, MUTED, SURFACE, TEXT } from '@/ui/theme';

/**
 * The bar above the delivered page: what this tool is, its ▶ Run, how the last
 * run went.
 *
 * ▶ Run here is not a second kind of run. It is the tool's own OK button --
 * what an application offers when its window has nothing of its own to press,
 * and what it still offers when it has: "go, on what is on the page now". It
 * belongs above the page, in both places the page is shown, because that is
 * where the person looking at the page can see it.
 *
 * Both hosts draw it: `runtime/RuntimeApp.tsx` for a tool someone was handed,
 * and the editor's Preview tab. The editor's toolbar has a ▶ Run too, and it
 * means the thing one level up -- *start this*, which for a graph with a page
 * is opening the window this bar sits on.
 */
export default function DeliveredHeader({
  onRun, ready = true, tools, note,
}: {
  onRun: () => void;
  /** False while the graph is still being fetched: a deployed tool's first moment. */
  ready?: boolean;
  /** Buttons of the host's own, left of ▶ Run — a deployed tool's ⚙ AI Settings. */
  tools?: ReactNode;
  /** Said right of ▶ Run: a deployed tool's clock. */
  note?: ReactNode;
}) {
  const metadata = useGraphStore((s) => s.metadata);
  const isExecuting = useGraphStore((s) => s.isExecuting);
  const executionResult = useGraphStore((s) => s.executionResult);

  const status = executionResult?.status;
  const statusLabel = isExecuting ? '⏳ Running…' : status === 'success' ? '✅ Done' : status === 'error' ? '❌ Failed' : '';

  return (
    <header
      className="flex items-center gap-3 px-4 py-2 shrink-0"
      style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
    >
      <span className="text-sm font-semibold" style={{ color: TEXT }}>
        {metadata.name || 'AI-Graph'}
      </span>
      {metadata.description && (
        <span className="text-xs truncate" style={{ color: DIM }}>{metadata.description}</span>
      )}

      <div className="flex-1" />

      {tools}
      <button
        onClick={onRun}
        disabled={!ready || isExecuting}
        className="px-4 py-1.5 text-xs rounded-lg font-semibold shrink-0"
        style={{
          background: !ready || isExecuting ? '#374151' : ACCENT,
          color: 'white',
          opacity: !ready || isExecuting ? 0.7 : 1,
        }}
        title="Run this tool on what is on the page now. Anything it still needs is asked for first."
      >
        {isExecuting ? '⏳ Running…' : '▶ Run'}
      </button>
      {note}
      {statusLabel && (
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: status === 'error' ? DANGER_TEXT : MUTED }}>
          {statusLabel}
        </span>
      )}
    </header>
  );
}
