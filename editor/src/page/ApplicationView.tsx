import { useMemo, useState } from 'react';
import type { GraphNode } from '@/graph';
import { GuiSurfacePage } from './GuiPage';
import { pageInUse } from './pageInUse';
import { usePage } from './usePage';
import { useRound } from './useRound';
import DeliveredHeader from './DeliveredHeader';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphStore } from '@/store/graphStore';
import { setEdit, useSession } from '@/api/session';
import { errorText } from '@/api/errorText';
import { interfaceOf } from '@engine/execution/graphInterface.ts';
import { pageStarts } from '@engine/execution/triggers.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { DANGER_TEXT, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';

/** Hand the server the document, so what runs is what is being edited. */
const holdDocument = () => useGraphStore.getState().holdDocument();

/**
 * The application, running (▶ Run, `app/application.ts`): its page, as the
 * deployed tool draws it -- the same component, not a rendition.
 *
 * `GuiSurfacePage` is what `runtime/RuntimeApp.tsx` renders when a bundle is
 * opened on someone else's machine, under the same `DeliveredHeader`, and
 * each round goes through the same `useRound` against the same session. So
 * what is seen here is what they get: a block unreadable, mis-sized or
 * missing in the bundle is so here, because there is nothing else to be.
 *
 * It is the tool in use, not the document: what is set on its page is the
 * session's, never an edit of the graph -- nothing to undo, nothing to save.
 * What the page starts lights up the nodes on the graph next door. The graph
 * runs when the page is used -- a button, a file picked, a box that says so.
 */
export default function ApplicationView() {
  const metadata = useGraphStore((s) => s.metadata);
  const nodes = useGraphStore((s) => s.rfNodes);
  const { widgets } = usePage();
  // What starts a round and what one hands back are the nodes' to say: no edges needed.
  const graph = useMemo(
    () => ({ metadata, nodes: nodes.map((node) => node.data.graphNode as GraphNode), edges: [] }),
    [metadata, nodes],
  );
  // Whether using the page starts the graph -- or only shows what its trigger
  // nodes, or its one run at start, made.
  const starts = pageStarts(graph, engineRegistry);
  // What a page without blocks shows: the graph's outputs, under their labels.
  const outputs = useMemo(
    () => interfaceOf(graph, engineRegistry).outputs.map(({ name, label }) => ({ name, label })),
    [graph],
  );
  const session = useSession();
  const round = useRound(holdDocument);
  const [opening, setOpening] = useState('');

  /**
   * The tool as it is delivered, in a window of its own: the document is
   * handed to the server and `runtime.html` is opened against it -- the same
   * page, the same entry point and the same routes a bundle serves, with no
   * editor in the window, and the same session as this tab.
   */
  const openAsTool = async () => {
    setOpening('Opening…');
    try {
      await holdDocument();
      // Named, so pressing it again reloads the tool's own window instead of
      // leaving a trail of them.
      const opened = window.open('runtime.html', 'ai-graph-tool');
      setOpening(opened ? '' : 'The browser blocked the window. Allow pop-ups for this page.');
    } catch (error) {
      setOpening(errorText(error, 'The tool could not be opened.'));
    }
  };

  const design = {
    name: metadata.name,
    description: metadata.description,
    scheme: metadata.gui_scheme,
    blocks: widgets,
    outputs,
    empty: nodes.length === 0,
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: SUNKEN }}>
      <DeliveredHeader
        name={metadata.name}
        description={metadata.description}
        round={session.round}
        tools={(
          <>
            {opening && opening !== 'Opening…' && (
              <span className="text-xs" style={{ color: DANGER_TEXT }}>{opening}</span>
            )}
            <button
              onClick={() => { void openAsTool(); }}
              disabled={opening === 'Opening…'}
              className="px-3 py-1.5 text-xs rounded-lg shrink-0"
              style={NEUTRAL_BUTTON}
              title="A window of its own, served exactly as a bundle serves it. Nothing is written to disk."
            >
              ⧉ Open as a tool
            </button>
          </>
        )}
      />
      <div className="px-8 py-1.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          Running
        </span>
        <span className="text-xs" style={{ color: DIMMER }}>
          {starts
            ? 'As whoever gets it will use it: the graph runs when you use the page. ■ Stop ends it.'
            : 'As whoever gets it will use it: what starts the graph starts it, and the page shows what it makes. ■ Stop ends it.'}
        </span>
      </div>

      <GuiSurfacePage
        page={pageInUse(design, session)}
        onValue={(block, value) => setEdit(block.id, value)}
        onEvent={(block) => { void round.run(block.id); }}
      />

      <RequirementsDialog
        requirements={round.requirements}
        onSubmit={round.submit}
        onCancel={round.cancel}
      />
    </div>
  );
}
