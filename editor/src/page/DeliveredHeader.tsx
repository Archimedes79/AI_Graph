import type { ReactNode } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { DANGER_TEXT, DIM, LINE, MUTED, SURFACE, TEXT } from '@/ui/theme';

/**
 * The bar above the delivered page: what this tool is -- the graph's name and
 * description -- and how its last round went.
 *
 * It has no ▶ Run. A tool runs when it is started (`startEvents`: its trigger
 * nodes, or, with nothing on its page to start it, the whole graph once) and
 * afterwards when its page is used -- its buttons, and the blocks that say
 * they start it. A ▶ Run beside a page's own button was a second button for
 * the same press.
 *
 * Both hosts draw the bar: `runtime/RuntimeApp.tsx` for a tool someone was
 * handed, and the editor's running application (`ApplicationView`).
 */
export default function DeliveredHeader({ tools, note }: {
  /** Buttons of the host's own -- a deployed tool's ⚙ AI Settings, the editor's pop-out. */
  tools?: ReactNode;
  /** Said after them: a deployed tool's clock. */
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
      {note}
      {statusLabel && (
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: status === 'error' ? DANGER_TEXT : MUTED }}>
          {statusLabel}
        </span>
      )}
    </header>
  );
}
