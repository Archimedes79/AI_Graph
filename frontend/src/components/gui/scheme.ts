// The page's colour scheme: one choice for the whole interface, from a closed
// set.
//
// `tone` says what role a *block* plays; this says what the page as a whole
// looks like. Together they are the two levels a document needs and the two a
// colour picker would collapse into one bad decision — every accent below is
// picked to sit legibly on the same surfaces, so no combination of block tones
// and page scheme can come out wrong.
//
// Stored on `metadata.extra.gui_scheme`: presentation of the whole graph, not a
// property of any node, and the one place graph-level settings already live.

export type SchemeId = 'indigo' | 'teal' | 'amber' | 'rose' | 'slate';

export interface Scheme {
  id: SchemeId;
  label: string;
  /** The accent: selection, `tone: accent`, links. */
  accent: string;
  /** Text and detail on an accent-tinted background. */
  accentText: string;
  /** The accent at low opacity, for an `accent` block's fill. */
  accentFill: string;
}

export const SCHEMES: Scheme[] = [
  { id: 'indigo', label: 'Indigo', accent: '#6366f1', accentText: '#a5b4fc', accentFill: 'rgba(99,102,241,0.10)' },
  { id: 'teal', label: 'Petrol', accent: '#14b8a6', accentText: '#5eead4', accentFill: 'rgba(20,184,166,0.10)' },
  { id: 'amber', label: 'Bernstein', accent: '#d97706', accentText: '#fcd34d', accentFill: 'rgba(217,119,6,0.12)' },
  { id: 'rose', label: 'Rosé', accent: '#e11d48', accentText: '#fda4af', accentFill: 'rgba(225,29,72,0.10)' },
  { id: 'slate', label: 'Graphit', accent: '#64748b', accentText: '#cbd5e1', accentFill: 'rgba(100,116,139,0.14)' },
];

export const DEFAULT_SCHEME: SchemeId = 'indigo';

export function scheme(id: string | undefined): Scheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

/**
 * The scheme as CSS variables, set on the page's root element.
 *
 * Variables rather than props threaded through every widget: a widget that
 * wants the accent writes `var(--gui-accent)` and needs to know nothing about
 * schemes, which is what keeps a new widget kind from having to learn about
 * this at all.
 */
export function schemeVars(id: string | undefined): React.CSSProperties {
  const active = scheme(id);
  return {
    '--gui-accent': active.accent,
    '--gui-accent-text': active.accentText,
    '--gui-accent-fill': active.accentFill,
  } as React.CSSProperties;
}
