import React from 'react';
import { GuiSurfacePage, useSurfaceBlocks } from './GuiPage';
import { DIMMER, LINE, MUTED, SUNKEN } from '../../ui/theme';

/**
 * What the deployed tool looks like — the same component, not a rendition.
 *
 * `GuiSurfacePage` is what `runtime/RuntimeApp.tsx` renders when a bundle is
 * opened on someone else's machine. Rendering it here means the preview cannot
 * flatter: if a block is unreadable, mis-sized or missing in the bundle, it is
 * unreadable, mis-sized or missing here, because there is nothing else to be.
 *
 * The chrome around it is deliberately thin. This is not a third editor; it is
 * a window onto the delivered thing, and the fields in it are live so you can
 * try the tool the way its user will — type, press ▶, read the result.
 */
export default function PreviewTab() {
  const blocks = useSurfaceBlocks();

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: SUNKEN }}>
      <div className="px-8 py-2 flex items-center gap-3" style={{ borderBottom: `1px solid ${LINE}` }}>
        <span className="text-xs" style={{ color: MUTED }}>
          Ausgeliefert
        </span>
        <span className="text-xs" style={{ color: DIMMER }}>
          Dieselbe Seite ohne Werkzeuge — bedienbar, wie sie beim Empfänger läuft.
        </span>
      </div>

      {blocks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: DIMMER }}>
            Noch keine Oberfläche. Im Tab „Oberfläche“ Elemente auf die Seite ziehen.
          </p>
        </div>
      ) : (
        <GuiSurfacePage />
      )}
    </div>
  );
}
