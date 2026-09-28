import { useState } from 'react';
import { GuiSurfacePage, usePage } from './GuiPage';
import { useDeliveredRun } from './useDeliveredRun';
import DeliveredHeader from './DeliveredHeader';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';

/**
 * The application, running (▶ Run, `app/application.ts`): its page, as the
 * deployed tool draws it -- the same component, not a rendition.
 *
 * `GuiSurfacePage` is what `runtime/RuntimeApp.tsx` renders when a bundle is
 * opened on someone else's machine, under the same `DeliveredHeader`, and
 * each round goes through the same `useDeliveredRun`. So what is seen here is
 * what they get: a block unreadable, mis-sized or missing in the bundle is so
 * here, because there is nothing else to be.
 *
 * It runs attached to the document: what the page starts lights up the nodes
 * on the graph next door. The graph runs when the page is used -- a button, a
 * file picked, a box that says so; its fields hold what they were set to.
 */
export default function ApplicationView() {
  const blocks = usePage().widgets;
  const delivered = useDeliveredRun();
  const [opening, setOpening] = useState('');

  /**
   * The tool as it is delivered, in a window of its own: the graph is handed
   * to the server and `runtime.html` is opened against it -- the same page,
   * the same entry point and the same routes a bundle serves, with no editor
   * in the window. Nothing is written to disk, and the window keeps the graph
   * it was given until it is opened again, which is what a delivered tool does.
   */
  const openAsTool = async () => {
    setOpening('Opening…');
    try {
      // The tool someone is handed is the whole document, not the level that is open.
      await call('holdGraph', useGraphStore.getState().rootGraph());
      // Named, so pressing it again reloads the tool's own window instead of
      // leaving a trail of them.
      const opened = window.open('runtime.html', 'ai-graph-tool');
      setOpening(opened ? '' : 'The browser blocked the window. Allow pop-ups for this page.');
    } catch (error) {
      setOpening(errorText(error, 'The tool could not be opened.'));
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: SUNKEN }}>
      <DeliveredHeader
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
          As whoever gets it will use it: the graph runs when you use the page. ■ Stop ends it.
        </span>
      </div>

      {/* Without blocks the delivered tool shows what it does and what its run
          hands back, and so does this: it is the same component. */}
      {blocks.length === 0 && (
        <p className="px-8 pt-4 text-xs" style={{ color: DIMMER }}>
          No page yet: until blocks are added on the Page tab, the tool shows this.
        </p>
      )}
      <GuiSurfacePage onRun={(trigger) => { void delivered.run(trigger); }} />

      <RequirementsDialog
        requirements={delivered.requirements}
        onSubmit={delivered.submit}
        onCancel={delivered.cancel}
      />
    </div>
  );
}
