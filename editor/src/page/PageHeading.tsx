import type { GraphNode } from '@/graph';
import { FIELD_ON_SURFACE, LINE, MUTED, SURFACE } from '@/ui/theme';

/** A change to a page's own words: its name, or what it is for. */
export type PageWords = Partial<Pick<GraphNode, 'label' | 'description'>>;

/**
 * Above the page being built: what it is called, and what it is for.
 *
 * A gui node has no dialog -- opening one comes here, to the page -- so this is
 * the one place its name and description can be changed. Before, nowhere could:
 * a new page stayed "GUI Node" for good, and that is what a node wired to one of
 * its blocks was told the page is called ('… on the page "GUI Node"'), what the
 * canvas showed, and what the project's interface.json and flow.js said, beside
 * a description nobody could write.
 *
 * One line per gui node: the page is one, but its blocks may be kept on more
 * than one node, and each has a name of its own.
 */
export default function PageHeading({ nodes, onChange }: {
  nodes: GraphNode[];
  onChange: (nodeId: string, words: PageWords) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <header
      className="px-8 py-2 flex flex-col gap-1.5 shrink-0"
      style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
    >
      {nodes.map((node) => (
        <div key={node.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
            Page
            <input
              className="rounded px-2 py-1 text-sm font-semibold"
              style={{ ...FIELD_ON_SURFACE, width: '14rem' }}
              value={node.label}
              aria-label="Name of the page"
              placeholder="Name of the page"
              title="What this page is called — on the canvas, and to every node wired to one of its blocks"
              onChange={(e) => onChange(node.id, { label: e.target.value })}
            />
          </label>
          <label className="flex flex-1 items-center gap-2 text-xs" style={{ color: MUTED, minWidth: '16rem' }}>
            About
            <input
              className="flex-1 min-w-0 rounded px-2 py-1 text-xs"
              style={FIELD_ON_SURFACE}
              value={node.description}
              aria-label="What the page is for"
              placeholder="What this page is for (optional)"
              title="Written into the project's interface.json and flow.js"
              onChange={(e) => onChange(node.id, { description: e.target.value })}
            />
          </label>
        </div>
      ))}
    </header>
  );
}
