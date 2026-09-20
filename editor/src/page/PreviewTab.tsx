import { GuiSurfacePage, useSurfaceBlocks } from './GuiPage';
import { useDeliveredRun } from './useDeliveredRun';
import DeliveredHeader from './DeliveredHeader';
import RequirementsDialog from '@/ui/RequirementsDialog';
import { DIMMER, LINE, MUTED, SUNKEN } from '@/ui/theme';

/**
 * What the deployed tool looks like — the same component, not a rendition.
 *
 * `GuiSurfacePage` is what `runtime/RuntimeApp.tsx` renders when a bundle is
 * opened on someone else's machine, under the same `DeliveredHeader`, started
 * by the same `useDeliveredRun`. Rendering it here means the preview cannot
 * flatter: if a block is unreadable, mis-sized or missing in the bundle, it is
 * unreadable, mis-sized or missing here, because there is nothing else to be.
 *
 * This is the window ▶ Run in the toolbar opens. It is the tool, running,
 * attached to the document — so what a run produces still lights up the nodes
 * on the graph canvas next door, which is the one thing the detached window
 * (*Open as tool*) cannot do.
 */
export default function PreviewTab() {
  const blocks = useSurfaceBlocks();
  const delivered = useDeliveredRun();

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: SUNKEN }}>
      <DeliveredHeader onRun={() => { void delivered.run(); }} />
      <div className="px-8 py-1.5 flex items-center gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          As delivered
        </span>
        <span className="text-xs" style={{ color: DIMMER }}>
          The same page without the tools — it works here exactly as it will for whoever gets it.
          Nothing runs until you use a block, or press ▶ Run above.
        </span>
      </div>

      {blocks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: DIMMER }}>
            No page yet. Add blocks to it on the “GUI editor” tab.
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
