// How a block sits on the page, chosen from a closed set rather than picked
// from a colour wheel.
//
// A colour picker is how interfaces get ugly: every value is available, most
// combinations are wrong, and the person choosing is not a designer. Four roles
// drawn from the one palette cannot be combined badly — the same reason LaTeX
// gives you `\section` and not a font size.
//
// Named by role, not by appearance, so the names stay true when the palette
// changes (see ui/theme.ts, which is built on the same rule).
import type { CSSProperties } from 'react';
import { ACCENT, LINE, SUNKEN } from '../../ui/theme';

export type Tone = 'plain' | 'raised' | 'sunken' | 'accent';

export const TONES: Tone[] = ['plain', 'raised', 'sunken', 'accent'];

export const TONE_LABELS: Record<Tone, string> = {
  plain: 'Plain — no box (headings, prose)',
  raised: 'Raised — lifts off the page (windows, plots)',
  sunken: 'Sunken — recessed (input fields)',
  accent: 'Accent — tinted (the one thing to notice)',
};

/**
 * The block's own chrome.
 *
 * `plain` is the important one: it is what turns a heading into a heading
 * instead of a labelled box, and it is why the runtime window stopped looking
 * like an inspector. Every widget used to get the same border and background
 * unconditionally, plus a truncated dump of its own output underneath.
 */
export function toneStyle(tone: Tone | undefined): CSSProperties {
  switch (tone) {
    case 'plain':
      return { background: 'transparent', border: '1px solid transparent' };
    case 'sunken':
      return { background: SUNKEN, border: `1px solid ${LINE}` };
    case 'accent':
      return {
        background: 'var(--gui-accent-fill, rgba(99,102,241,0.10))',
        border: '1px solid var(--gui-accent, #6366f1)',
      };
    case 'raised':
    default:
      return { background: 'rgba(255,255,255,0.03)', border: `1px solid ${LINE}` };
  }
}

/** Does this tone draw a box at all? A plain block also drops its caption. */
export function toneIsBare(tone: Tone | undefined): boolean {
  return tone === 'plain';
}
