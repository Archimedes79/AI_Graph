import type { ReactNode } from 'react';
import type { RoundSnapshot } from '@/api/client';
import { DANGER_TEXT, DIM, LINE, MUTED, SURFACE, TEXT } from '@/ui/theme';

/** How a round went, in a word: going, done, or failed -- nothing before the first. */
export function roundStatus(round: RoundSnapshot | null): { label: string; failed: boolean } {
  if (!round) return { label: '', failed: false };
  if (!round.done) return { label: '⏳ Running…', failed: false };
  const status = round.result?.status;
  if (status === 'success') return { label: '✅ Done', failed: false };
  if (status === 'error' || (!round.result && round.error && !round.cancelled)) return { label: '❌ Failed', failed: true };
  return { label: '', failed: false };
}

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
 * Every host draws the bar: `runtime/RuntimeApp.tsx` for a tool someone was
 * handed, and the editor's running application (`ApplicationView`).
 */
export default function DeliveredHeader({ name, description, round, tools, note }: {
  name: string;
  description: string;
  /** The round going now, or the last one. */
  round: RoundSnapshot | null;
  /** Buttons of the host's own -- a deployed tool's ⚙ AI Settings, the editor's pop-out. */
  tools?: ReactNode;
  /** Said after them: a deployed tool's clock. */
  note?: ReactNode;
}) {
  const status = roundStatus(round);
  return (
    <header
      className="flex items-center gap-3 px-4 py-2 shrink-0"
      style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
    >
      <span className="text-sm font-semibold" style={{ color: TEXT }}>
        {name || 'AI-Graph'}
      </span>
      {description && (
        <span className="text-xs truncate" style={{ color: DIM }}>{description}</span>
      )}

      <div className="flex-1" />

      {tools}
      {note}
      {status.label && (
        <span className="text-xs font-medium whitespace-nowrap" style={{ color: status.failed ? DANGER_TEXT : MUTED }}>
          {status.label}
        </span>
      )}
    </header>
  );
}
