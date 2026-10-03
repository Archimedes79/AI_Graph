import { usePage } from '@/page/usePage';
import { DIM, LINE, MUTED, SUCCESS, TEXT } from '@/ui/theme';

export type EditorView = 'graph' | 'design' | 'app';

/** The views, by the one word each: the page is made of blocks, and nothing else is called anything. */
const VIEW_TABS: { id: EditorView; label: string; hint: string }[] = [
  { id: 'graph', label: 'Graph', hint: 'Nodes and the wires between them' },
  { id: 'design', label: 'Page', hint: 'The page this tool shows — build it here, block by block' },
  { id: 'app', label: 'App', hint: 'The application, running: its page, as whoever gets it will use it. ■ Stop ends it' },
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
 * The third is there while the application runs (▶ Run, `app/application.ts`):
 * its page, the component a deployed tool runs -- to go back to from the graph,
 * whose cards light up as the page is used. Stopped, it goes.
 */
export default function ViewTabs({
  view, onChange, running = false,
}: { view: EditorView; onChange: (view: EditorView) => void; running?: boolean }) {
  // How many blocks the page has, so the tab says whether there is one.
  const blockCount = usePage().widgets.length;

  return (
    <nav className="flex items-center gap-1 shrink-0" aria-label="Views">
      {VIEW_TABS.filter((tab) => tab.id !== 'app' || running).map((tab) => {
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
            {tab.id === 'app' && <span className="mr-1.5" style={{ color: SUCCESS }} aria-hidden="true">●</span>}
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
