import { useGraphStore } from '@/store/graphStore';
import { DIMMER, MUTED, TEXT } from '@/ui/theme';

/**
 * Where you are, and the way back out: the graph at the top, then one step
 * per node gone into. Each crumb leaves as many levels as it takes to get
 * there; the last one is where you stand. Nothing at all at the top.
 *
 * No level closes while a run is in flight -- its result would land on the
 * canvas of another graph (`openSubgraph`) -- so the crumbs wait for it, and
 * say so. A crumb used to close levels one by one until the depth was
 * reached, and during a run none closed: the click spun forever and froze
 * the tab. The store's `closeSubgraphsTo` stops where a level will not close.
 */
export default function SubgraphTrail() {
  const subgraphStack = useGraphStore((s) => s.subgraphStack);
  const closeSubgraphsTo = useGraphStore((s) => s.closeSubgraphsTo);
  const running = useGraphStore((s) => s.isExecuting);
  if (subgraphStack.length === 0) return null;

  // `depth` is how many levels remain when you are standing on that step.
  const trail = [
    { depth: 0, name: subgraphStack[0].graph.metadata.name || 'Graph' },
    ...subgraphStack.map((frame, level) => ({
      depth: level + 1,
      name: frame.graph.nodes.find((node) => node.id === frame.nodeId)?.label || frame.nodeId,
    })),
  ];

  return (
    <div className="flex items-center gap-1 text-xs">
      {trail.map((step, index) => {
        const here = index === trail.length - 1;
        return (
          <span key={step.depth} className="flex items-center gap-1">
            {index > 0 && <span style={{ color: DIMMER }}>▸</span>}
            <button
              type="button"
              className="px-2 py-0.5 rounded"
              style={{ color: here ? TEXT : MUTED }}
              disabled={here || running}
              title={here ? 'You are here' : running ? 'A run is going on. The way out opens when it is over.' : `Back out to ${step.name}`}
              onClick={() => closeSubgraphsTo(step.depth)}
            >
              {step.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
