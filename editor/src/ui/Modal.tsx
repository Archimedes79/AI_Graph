import React, { useEffect, useRef, useState } from 'react';
import { LINE, MUTED, PANEL, SCRIM, SUNKEN, TEXT } from './theme';

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Buttons for the bottom bar. Omit for a modal with no actions of its own. */
  footer?: React.ReactNode;
  /** Tailwind max-width class. */
  maxWidth?: string;
  /**
   * Clicking the backdrop closes the modal. Turn this off where a stray click
   * would lose typed input (or while a request is in flight).
   */
  dismissOnBackdrop?: boolean;
  /** Escape closes the modal. Off while something is mid-flight. */
  dismissOnEscape?: boolean;
  /**
   * Cap the modal at 90vh and scroll its body. On by default: a dialog taller
   * than the window hides its own footer, so Save and Done cannot be reached
   * and the ✕ has gone off the top — which is what the settings dialog did,
   * at 1109 pixels in a 720 pixel window. Turn it off only for something that
   * must be allowed to grow past the viewport.
   */
  scrollBody?: boolean;
}

/**
 * Whether Escape is this dialog's to act on: only while it is the one on top
 * -- the last dialog drawn, whether it was opened inside this one (a file
 * browser in a node's dialog) or beside it (the file browser over the Save
 * dialog whose path box it fills). Every dialog hears Escape on the document,
 * and one Escape closed both, in the order the two happened to listen.
 */
export function hearsEscape(panel: Element | null, page: Pick<Document, 'querySelectorAll'>): boolean {
  if (!panel) return false;
  const open = page.querySelectorAll('[role="dialog"]');
  return open[open.length - 1] === panel;
}

/**
 * The one modal shell.
 *
 * Nine overlays used to author this same backdrop/panel/header/footer skeleton
 * by hand, which is how they ended up disagreeing about z-index, about whether
 * a backdrop click closes them, and — uniformly — about keyboard and screen
 * reader support: none of them could be closed with Escape, and none managed
 * focus, so Tab walked straight into the canvas behind the overlay.
 *
 * Anything genuinely per-modal is a prop; everything else lives here once, so
 * a fix to focus handling reaches every dialog in the app at the same time.
 */
export default function Modal({
  title,
  onClose,
  children,
  footer,
  maxWidth = 'max-w-lg',
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  scrollBody = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // What had the focus before the dialog, read as it is first drawn: a field
  // in it may take the focus (autoFocus) before the effect below runs.
  const [before] = useState(() => (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null));

  useEffect(() => {
    const panel = panelRef.current;
    const focused = document.activeElement as HTMLElement | null;
    // A field in it that took the focus keeps it: the panel used to take it
    // back, and a path typed into the Save box went nowhere. Otherwise the
    // panel itself takes it, rather than a guessed first field: that puts the
    // screen reader inside the dialog and makes Escape work at once. Closed,
    // the focus goes back where it came from -- to the Save box, when this
    // was the file browser opened over it.
    const inside = !!panel && panel.contains(focused);
    const cameFrom = inside ? before : focused;
    if (!inside) panel?.focus();
    return () => cameFrom?.focus?.();
  }, [before]);

  useEffect(() => {
    if (!dismissOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // One Escape, one dialog: the one on top takes it, and marks it taken
      // for a dialog under it that hears it after this one has closed.
      if (event.key !== 'Escape' || event.defaultPrevented || !hearsEscape(panelRef.current, document)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dismissOnEscape, onClose]);

  // Keep Tab inside the dialog: without this the next Tab lands on the canvas
  // behind the backdrop, where clicks do not even reach.
  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    }
  };

  // `nokey`: a key pressed in a dialog is the dialog's. ReactFlow passes over
  // a key only in a text field or under `.nokey`, so Backspace on a focused
  // button deleted the node selected on the canvas behind the dialog.
  return (
    <div
      className="nokey fixed inset-0 flex items-center justify-center"
      style={{ background: SCRIM, zIndex: 50 }}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`rounded-xl overflow-hidden shadow-2xl w-full ${maxWidth} mx-4 outline-none ${scrollBody ? 'flex flex-col' : ''}`}
        style={{ ...PANEL, ...(scrollBody ? { maxHeight: '90vh' } : {}) }}
        onClick={(e) => e.stopPropagation()}
        onKeyDownCapture={onKeyDownCapture}
      >
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ background: SUNKEN, borderBottom: `1px solid ${LINE}` }}
        >
          <span className="text-sm font-semibold" style={{ color: TEXT }}>{title}</span>
          <button onClick={onClose} aria-label="Close dialog" style={{ color: MUTED }}>✕</button>
        </div>

        <div className={scrollBody ? 'flex-1 overflow-y-auto' : ''}>{children}</div>

        {footer && (
          <div
            className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
