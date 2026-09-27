import { useSurfaceBlocks } from '@/page/GuiPage';
import { ACCENT, DIMMER, LINE, MUTED, SURFACE } from '@/ui/theme';

export type EditorView = 'graph' | 'design' | 'preview';

/** The three views, by the one word each: the page is made of blocks, and nothing else is called anything. */
const VIEW_TABS: { id: EditorView; label: string; hint: string }[] = [
  { id: 'graph', label: 'Graph', hint: 'Nodes and the wires between them' },
  { id: 'design', label: 'Page', hint: 'The page this tool shows — build it here, block by block' },
  { id: 'preview', label: 'Preview', hint: 'Exactly what is delivered, and it works — try it' },
];

/**
 * Graph and page, side by side as two views of one document.
 *
 * They are not separate documents: the page is the graph's one page node, so
 * a block added there is a port added here. The Page tab exists because
 * designing a page inside a node's config dialog meant designing it through a
 * keyhole.
 *
 * The third is the same page with the builder's affordances gone — literally
 * the component a deployed tool runs, not a rendition of it. A preview built
 * from its own code is a preview that can flatter; this one cannot, and it is
 * where you check what you are about to hand someone.
 */
export default function ViewTabs({
  view, onChange,
}: { view: EditorView; onChange: (view: EditorView) => void }) {
  // How many blocks the page has, so the tab says whether there is one.
  const blockCount = useSurfaceBlocks().length;

  return (
    <div className="flex items-center gap-1 px-3 flex-shrink-0" style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}>
      {VIEW_TABS.map((tab) => {
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            title={tab.hint}
            className="px-4 py-2 text-sm transition-colors"
            style={{
              color: active ? ACCENT : MUTED,
              borderBottom: active ? `2px solid ${ACCENT}` : '2px solid transparent',
              background: 'transparent',
            }}
          >
            {tab.label}
            {tab.id === 'design' && blockCount > 0 && (
              <span className="ml-2 text-xs" style={{ color: DIMMER }}>{blockCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
