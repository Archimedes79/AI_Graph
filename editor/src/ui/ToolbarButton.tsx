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
}

/**
 * One toolbar control.
 *
 * The bar used to be a dozen visually identical text buttons in one flat row,
 * with emoji standing in for icons. What fixes that lives here: a real icon
 * set (lucide) and one shared size and hover treatment. Which button a bar is
 * *for* is said by the bar -- ▶ Run is drawn by the toolbar itself.
 */
export default function ToolbarButton({
  icon: Icon, label, title, onClick, disabled,
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
      className={`h-8 rounded-md flex items-center gap-1.5 text-xs font-medium transition-colors ${label ? 'px-2.5' : 'px-2'}`}
      style={{
        background: lit ? LINE : 'transparent',
        color: lit ? TEXT : MUTED,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <Icon size={15} strokeWidth={2} aria-hidden="true" />
      {label && <span>{label}</span>}
    </button>
  );
}

/** A hairline between two groups of related controls. */
export function ToolbarSeparator() {
  return <div aria-hidden="true" style={{ width: 1, height: 20, background: LINE, flexShrink: 0 }} />;
}
