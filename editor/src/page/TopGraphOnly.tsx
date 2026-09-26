import type { ReactNode } from 'react';
import { useGraphStore } from '@/store/graphStore';
import { DIMMER, MUTED, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';

/**
 * A view of the page, shown only where a page can be: in the graph at the top.
 *
 * Inside a node's graph the canvas shows that graph, and the GUI editor and the
 * preview used to show it too. The editor found no page in there and made one:
 * the first block added put a gui node inside the subgraph, which `check` then
 * rejects -- a page in there is never shown -- and the colour scheme was written
 * into the inner graph, where nothing reads it. The preview ran the inner graph
 * as if it were the tool. So in there they say where the page is, and take you
 * back up to it.
 */
export default function TopGraphOnly({ children }: { children: ReactNode }) {
  const inside = useGraphStore((s) => s.subgraphStack.length > 0);
  const closeSubgraphsTo = useGraphStore((s) => s.closeSubgraphsTo);
  // No level changes while a run is in flight -- its result would land on the
  // canvas of another graph (`openSubgraph`) -- so the way up waits for it. A
  // button that then did nothing, without a word, would look broken.
  const running = useGraphStore((s) => s.isExecuting);
  if (!inside) return <>{children}</>;

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 px-8" style={{ background: SUNKEN }}>
      <p className="text-sm" style={{ color: MUTED }}>
        The page belongs to the graph at the top.
      </p>
      <p className="text-xs text-center max-w-md" style={{ color: DIMMER }}>
        You are inside a node's graph, which runs as one part of the graph above it and has no page of its own.
        Go back up to build the page or try it.
      </p>
      <button
        className="mt-2 text-xs px-3 py-1.5 rounded-lg"
        style={{ ...NEUTRAL_BUTTON, opacity: running ? 0.5 : 1 }}
        disabled={running}
        onClick={() => closeSubgraphsTo(0)}
      >
        ↑ Back to the graph at the top
      </button>
      {running && (
        <p className="text-xs" style={{ color: DIMMER }}>
          A run is going on. The way up opens when it is over.
        </p>
      )}
    </div>
  );
}
