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
import { ACCENT, ACCENT_FILL, LINE, RAISE, SUNKEN } from '../../ui/theme';

export type Tone = 'plain' | 'raised' | 'sunken' | 'accent';

export const TONES: Tone[] = ['plain', 'raised', 'sunken', 'accent'];

export const TONE_LABELS: Record<Tone, string> = {
  plain: 'Plain — no box (headings, prose)',
  raised: 'Raised — lifts off the page (windows, plots)',
  sunken: 'Sunken — recessed (input fields)',
  accent: 'Accent — tinted (the one thing to notice)',
};

/** What a person may set on top of the tone: a frame, and a colour of their own. */
export interface Look {
  border?: boolean;
  background?: string;
}

/**
 * The block's own chrome.
 *
 * `plain` is the important one: it is what turns a heading into a heading
 * instead of a labelled box, and it is why the runtime window stopped looking
 * like an inspector. Every widget used to get the same border and background
 * unconditionally, plus a truncated dump of its own output underneath.
 *
 * The tone is the default; a `Look` overrides one thing at a time. A frame on
 * a plain block, or no frame on a raised one, is a choice about that block and
 * changes nothing else -- and a colour picked by hand is exactly that, the
 * person's own, not a fifth tone.
 */
export function toneStyle(tone: Tone | undefined, look: Look = {}): CSSProperties {
  const base = ((): CSSProperties => {
    switch (tone) {
      case 'plain':
        return { background: 'transparent', border: '1px solid transparent' };
      case 'sunken':
        return { background: SUNKEN, border: `1px solid ${LINE}` };
      case 'accent':
        return { background: ACCENT_FILL, border: `1px solid ${ACCENT}` };
      case 'raised':
      default:
        return { background: RAISE, border: `1px solid ${LINE}` };
    }
  })();
  if (look.border === true) base.border = `1px solid ${tone === 'accent' ? ACCENT : LINE}`;
  if (look.border === false) base.border = '1px solid transparent';
  if (look.background) base.background = look.background;
  return base;
}

/** Does the block draw a box at all? A bare block also drops its caption. */
export function toneIsBare(tone: Tone | undefined, look: Look = {}): boolean {
  if (look.border !== undefined) return !look.border && !look.background;
  return tone === 'plain' && !look.background;
}
