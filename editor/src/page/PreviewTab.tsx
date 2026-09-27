import { useState } from 'react';
import { GuiSurfacePage, useSurfaceBlocks } from './GuiPage';
import { useDeliveredRun } from './useDeliveredRun';
import DeliveredHeader from './DeliveredHeader';
import RequirementsDialog from '@/dialogs/RequirementsDialog';
import { useGraphStore } from '@/store/graphStore';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import { DANGER_TEXT, DIMMER, LINE, MUTED, NEUTRAL_BUTTON, SUNKEN } from '@/ui/theme';

/**
 * What the deployed tool looks like — the same component, not a rendition.
 *
 * `GuiSurfacePage` is what `runtime/RuntimeApp.tsx` renders when a bundle is
 * opened on someone else's machine, under the same `DeliveredHeader`, started
 * by the same `useDeliveredRun`. Rendering it here means the preview cannot
 * flatter: if a block is unreadable, mis-sized or missing in the bundle, it is
 * unreadable, mis-sized or missing here, because there is nothing else to be.
 *
 * It is the tool, running, attached to the document -- so what a run produces
 * still lights up the nodes on the graph canvas next door. Its header has no
 * ▶ Run of its own: the toolbar's is the one, on every tab. What it has is the
 * pop-out, the same tool detached.
 */
export default function PreviewTab() {
  const blocks = useSurfaceBlocks();
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
          As delivered
        </span>
        <span className="text-xs" style={{ color: DIMMER }}>
          The same page without the tools — it works here exactly as it will for whoever gets it.
          Nothing runs until you use a block, or press ▶ Run in the toolbar.
        </span>
      </div>

      {blocks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: DIMMER }}>
            No page yet. Add blocks to it on the Page tab.
          </p>
        </div>
      ) : (
        <GuiSurfacePage onRun={(trigger) => { void delivered.run(trigger); }} />
      )}

      <RequirementsDialog
        requirements={delivered.requirements}
        onSubmit={delivered.submit}
        onCancel={delivered.cancel}
      />
    </div>
  );
}
