import type { ReactNode } from 'react';
import { ACCENT_TEXT, DIMMER, LINE, TEXT } from '@/ui/theme';

/**
 * One step of building a node, numbered in the order the work is done: what it
 * should do, what comes in, what comes out, how, and trying it.
 *
 * The node dialog used to be a column of fields in the order they were added
 * to the code -- the body before the ports it reads, the answer format after
 * the answer. Numbered, the order is the explanation: each step is what the
 * next one is written from.
 */
export default function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 pt-3" style={{ borderTop: n > 1 ? `1px solid ${LINE}` : undefined }} aria-label={title}>
      <div>
        <h3 className="text-sm font-semibold flex items-baseline gap-2" style={{ color: TEXT }}>
          <span className="text-xs font-mono px-1.5 rounded" style={{ color: ACCENT_TEXT, border: `1px solid ${LINE}` }}>{n}</span>
          {title}
        </h3>
        {hint && <p className="text-xs mt-0.5" style={{ color: DIMMER }}>{hint}</p>}
      </div>
      {children}
    </section>
  );
}
