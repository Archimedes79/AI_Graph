import React, { useEffect, useRef } from 'react';
import { LINE, MUTED, SURFACE } from './theme';

/** Wide enough for a code editor and a result, narrow enough that the canvas stays usable beside it at 1024 pixels. */
export const SIDE_PANEL_WIDTH = 440;

/**
 * Whether Escape is the panel's to act on: only while it is on screen -- its
 * view may be hidden, the panel kept for when it is back -- and while no
 * dialog or menu is open, which hears it first: a file browser opened from
 * the panel, or the File menu, is closed by Escape, and the panel with it was
 * one close too many.
 */
export function panelHearsEscape(
  panel: Pick<HTMLElement, 'offsetParent'> | null,
  page: Pick<Document, 'querySelector'>,
): boolean {
  return panel !== null && panel.offsetParent !== null && page.querySelector('[role="dialog"], [role="menu"]') === null;
}

/**
 * A panel docked on the right, beside what it is about -- in place of a dialog
 * over it: the canvas stays usable, and choosing something else there shows
 * that instead. ✕ and Escape close it, as they closed the dialog.
 *
 * It takes no focus when it opens: it opens on a click on the canvas, and the
 * keys stay there -- Delete deletes the node just clicked. `nokey`: a key
 * pressed in the panel is the panel's, and ReactFlow passes it over.
 */
export default function SidePanel({ kicker, title, onClose, children }: {
  /** A small line above the title: what the thing is. */
  kicker?: React.ReactNode;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // One an editor inside took for itself -- closing its search, say -- is not this one's.
      if (event.key !== 'Escape' || event.defaultPrevented || !panelHearsEscape(panelRef.current, document)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      className="nokey flex flex-col flex-shrink-0 min-h-0"
      style={{ width: SIDE_PANEL_WIDTH, background: SURFACE, borderLeft: `1px solid ${LINE}` }}
    >
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: `1px solid ${LINE}` }}>
        <div className="flex-1 min-w-0">
          {kicker && <div className="mb-1.5">{kicker}</div>}
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-sm hover-raise"
          style={{ color: MUTED }}
          title="Close (Esc)"
          aria-label="Close the panel"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </aside>
  );
}
