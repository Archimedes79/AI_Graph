import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { LINE, MUTED, NEUTRAL_BUTTON, TEXT } from '../ui/theme';

interface ToolbarButtonProps {
  icon: LucideIcon;
  /** Omit for an icon-only button; the label still reaches screen readers via `title`. */
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  /** The one action a bar is *for*. At most one per group. */
  primary?: boolean;
  danger?: boolean;
}

/**
 * One toolbar control.
 *
 * The bar used to be a dozen visually identical text buttons in one flat row,
 * with emoji standing in for icons, so nothing told you which of them you were
 * likely to want. Three things fix that and they all live here: a real icon set
 * (lucide, already a dependency and previously unused), one shared size and
 * hover treatment, and a `primary` variant so Run reads as the action and the
 * rest as chrome.
 */
export default function ToolbarButton({
  icon: Icon, label, title, onClick, disabled, primary, danger,
}: ToolbarButtonProps) {
  const [hover, setHover] = React.useState(false);

  const background = danger ? '#b91c1c' : primary ? undefined : hover && !disabled ? LINE : 'transparent';
  const color = danger || primary ? 'white' : hover && !disabled ? TEXT : MUTED;

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
        background: primary && !danger ? NEUTRAL_BUTTON.background : background,
        color,
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
