import React, { useEffect, useRef } from 'react';
import { LINE, MUTED, PANEL, SUNKEN, TEXT } from '../ui/theme';

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
  /** Raise above another modal (the connector editor opens over the node editor). */
  zIndex?: number;
  /** Let the body scroll and cap the modal's height — for tall editors. */
  scrollBody?: boolean;
  /** Fixed row between header and body, e.g. a tab bar that must not scroll. */
  subHeader?: React.ReactNode;
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
  zIndex = 50,
  scrollBody = false,
  subHeader,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the panel itself rather than a guessed first field: it puts the
    // screen reader inside the dialog and makes Escape work immediately,
    // without stealing the caret from a field a caller autofocused.
    panelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  useEffect(() => {
    if (!dismissOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
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

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', zIndex }}
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

        {subHeader && <div className="shrink-0">{subHeader}</div>}

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
