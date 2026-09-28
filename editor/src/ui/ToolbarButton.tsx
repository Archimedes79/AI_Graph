import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { LINE, MUTED, TEXT } from './theme';

interface ToolbarButtonProps {
  icon: LucideIcon;
  /** Omit for an icon-only button; the label still reaches screen readers via `title`. */
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  /** Drawn with a frame: the header's few actions of its own, beside ▶ Run. */
  framed?: boolean;
}

/**
 * One toolbar control.
 *
 * The bar used to be a dozen visually identical text buttons in one flat row,
 * with emoji standing in for icons. What fixes that lives here: a real icon
 * set (lucide) and one shared size and hover treatment. Which button a bar is
 * *for* is said by the bar -- ▶ Run is drawn by the toolbar itself.
 *
 * Its words show from 1280 pixels on; narrower, it is its icon, and the words
 * are its tooltip and what a screen reader says. With them at 1024 the bar was
 * 1470 pixels wide, and the whole page slid sideways under it. The file
 * actions went into one menu, which left room for the words at 1280.
 */
export default function ToolbarButton({
  icon: Icon, label, title, onClick, disabled, framed,
}: ToolbarButtonProps) {
  const [hover, setHover] = React.useState(false);

  const lit = hover && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label ?? title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`${framed ? 'h-9 rounded-lg' : 'h-8 rounded-md'} flex-shrink-0 flex items-center gap-1.5 text-xs font-medium transition-colors ${label ? 'px-2 xl:px-3' : 'px-2'}`}
      style={{
        background: lit ? LINE : 'transparent',
        border: framed ? `1px solid ${LINE}` : 'none',
        color: lit || framed ? TEXT : MUTED,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
      {label && <span className="hidden xl:inline whitespace-nowrap">{label}</span>}
    </button>
  );
}
