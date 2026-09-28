import { usePage } from '@/page/GuiPage';
import { DIM, LINE, MUTED, TEXT } from '@/ui/theme';

export type EditorView = 'graph' | 'design' | 'preview';

/** The three views, by the one word each: the page is made of blocks, and nothing else is called anything. */
const VIEW_TABS: { id: EditorView; label: string; hint: string }[] = [
  { id: 'graph', label: 'Graph', hint: 'Nodes and the wires between them' },
  { id: 'design', label: 'Page', hint: 'The page this tool shows — build it here, block by block' },
  { id: 'preview', label: 'Preview', hint: 'Exactly what is delivered, and it works — try it' },
];

/**
 * Graph and page, side by side as two views of one document -- in the
 * header, beside the graph's name, since they are views of it.
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
  const blockCount = usePage().widgets.length;

  return (
    <nav className="flex items-center gap-1 shrink-0" aria-label="Views">
      {VIEW_TABS.map((tab) => {
        const active = view === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            title={tab.hint}
            aria-current={active ? 'page' : undefined}
            className={`h-9 whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${active ? 'font-medium' : 'hover-raise'}`}
            style={{ color: active ? TEXT : MUTED, background: active ? LINE : 'transparent' }}
          >
            {tab.label}
            {tab.id === 'design' && blockCount > 0 && (
              <span className="ml-1.5 text-xs" style={{ color: DIM }}>{blockCount}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
