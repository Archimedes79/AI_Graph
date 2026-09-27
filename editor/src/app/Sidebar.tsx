import type { NodeType } from '@/graph';
import { NODE_BUILDERS } from '@/elements/registry';
import { ACCENT, DIMMER, LINE, SURFACE, TEXT } from '@/ui/theme';

/**
 * What the palette offers. Not the page: a graph has one, and the Page tab
 * makes it with its first block -- a page node dropped on the canvas was a
 * second way to make it, and a second page one nobody would ever see.
 */
const CATEGORIES: { label: string; types: NodeType[] }[] = [
  {
    // `input` had no palette entry at all: the node type existed, the editor
    // could load one, and there was no way to create one by hand. Every graph
    // that reads a file or a folder headlessly starts with it.
    label: 'Input',
    types: ['input', 'trigger'],
  },
  {
    label: 'Processing',
    types: ['data', 'ai', 'code'],
  },
  {
    label: 'Output',
    types: ['output'],
  },
  {
    // A graph of its own, one node wide from out here: the way a graph grows
    // in depth rather than in width.
    label: 'Structure',
    types: ['subgraph'],
  },
];

interface SidebarProps {
  onAddNode: (nodeType: NodeType) => void;
}

/**
 * The palette. Below 1280 pixels it is its icons, each named in its tooltip
 * and to a screen reader: with a node's panel open beside the canvas, the
 * words took the room the canvas needs at 1024.
 */
export default function Sidebar({ onAddNode }: SidebarProps) {
  return (
    <aside
      className="flex flex-col h-full overflow-y-auto w-14 xl:w-[220px]"
      style={{
        background: SURFACE,
        borderRight: `1px solid ${LINE}`,
        flexShrink: 0,
      }}
    >
      <div className="hidden xl:block px-4 py-4 border-b" style={{ borderColor: LINE }}>
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
          Node Palette
        </h2>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Drag or click to add
        </p>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.label} className="py-2 xl:py-3 border-b xl:border-b-0" style={{ borderColor: LINE }}>
          <h3 className="hidden xl:block px-4 text-xs font-medium uppercase tracking-wider mb-2" style={{ color: DIMMER }}>
            {cat.label}
          </h3>
          {cat.types.map((type) => (
            <button
              key={type}
              className="w-full flex items-center justify-center xl:justify-start gap-3 px-2 xl:px-4 py-2.5 text-sm text-left transition-colors hover-raise"
              style={{ color: TEXT }}
              onClick={() => onAddNode(type)}
              title={`${NODE_BUILDERS[type].label}: ${NODE_BUILDERS[type].hint}`}
              aria-label={NODE_BUILDERS[type].label}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/nodeType', type);
                e.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <span className="text-base">{NODE_BUILDERS[type].icon}</span>
              <span className="hidden xl:inline">{NODE_BUILDERS[type].label}</span>
            </button>
          ))}
        </div>
      ))}

      <div className="hidden xl:block mt-auto px-4 py-4 border-t" style={{ borderColor: LINE }}>
        <p className="text-xs" style={{ color: DIMMER }}>
          Click a node to open it beside the canvas. Connect ports by dragging from dot to dot.
        </p>
      </div>
    </aside>
  );
}
