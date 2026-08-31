// The colour scheme: one choice for the whole tool, from a closed set.
//
// A scheme is the entire palette -- page, panels, borders, text, accent, the
// tint behind a node -- not an accent colour. It was an accent colour for one
// round, which meant "Petrol" moved a few borders and nothing else. What people
// mean by a colour scheme is dark blue versus warm paper, and that is what
// these are.
//
// Every value here becomes a CSS variable on the app shell (see schemeVars),
// and every colour in `ui/theme.ts` is a `var()` pointing at one. So a scheme
// reaches everything at once while nothing has to be told about schemes: a
// component asks for SURFACE exactly as it always did.
//
// Three, deliberately. Enough that the tool can look like the person using it,
// few enough that none of them is bad -- a colour picker is how interfaces get
// ugly, and each of these was balanced as a whole.
//
// Stored on `metadata.gui_scheme`: presentation of the graph as a whole, so it
// travels with the file and a deployed tool looks like what was designed.

export type SchemeId = 'night' | 'paper' | 'graphite';

export interface Scheme {
  id: SchemeId;
  label: string;
  /** A light scheme. A few affordances need to know which way is up. */
  light?: boolean;

  // ---- surfaces -------------------------------------------------------------
  /** Recessed: the page itself, input fields, code areas. */
  sunken: string;
  /** Raised: panels, modals, nodes, cards. */
  surface: string;
  /** Borders, and the neutral button fill -- the same colour by design. */
  line: string;
  /** The barely-there lift of a block off the page. */
  raise: string;
  /** A row or button under the pointer. */
  hover: string;
  /** Behind a modal. */
  scrim: string;
  /** A node's title bar, over the node's own tint. */
  header: string;

  // ---- text -----------------------------------------------------------------
  text: string;
  muted: string;
  dim: string;
  dimmer: string;

  // ---- accent ---------------------------------------------------------------
  accent: string;
  /** Accent-coloured text on a normal surface. */
  accentText: string;
  /** The accent at low opacity: tinted notes, the `accent` tone's fill. */
  accentFill: string;
  /** Text on top of the accent itself -- a button's label. */
  onAccent: string;

  // ---- meaning --------------------------------------------------------------
  success: string;
  danger: string;
  dangerText: string;

  /** One tint per node type, so the canvas reads at a glance. */
  nodes: { input: string; ai: string; code: string; data: string; output: string; gui: string };
}

export const SCHEMES: Scheme[] = [
  {
    id: 'night',
    label: 'Nacht — dunkles Blau',
    sunken: '#0f1117', surface: '#1a1d2e', line: '#2d3148',
    raise: 'rgba(255,255,255,0.03)', hover: 'rgba(255,255,255,0.06)',
    scrim: 'rgba(0,0,0,0.70)', header: 'rgba(0,0,0,0.30)',
    text: '#e2e8f0', muted: '#94a3b8', dim: '#64748b', dimmer: '#475569',
    accent: '#6366f1', accentText: '#a5b4fc', accentFill: 'rgba(99,102,241,0.10)', onAccent: '#ffffff',
    success: '#22c55e', danger: '#ef4444', dangerText: '#fca5a5',
    nodes: { input: '#1e3a5f', ai: '#2d1b4e', code: '#1a3a2a', data: '#183b3b', output: '#3a2000', gui: '#4a1d3a' },
  },
  {
    id: 'paper',
    label: 'Papier — hell und warm',
    light: true,
    // Warm off-white rather than #fff, and ink rather than black: a page you can
    // look at for an afternoon. The accent is a burnt orange, the one hue that
    // stays legible both as a 1px border and as a filled button.
    sunken: '#efece3', surface: '#faf9f5', line: '#dcd8cb',
    raise: 'rgba(60,50,30,0.035)', hover: 'rgba(60,50,30,0.06)',
    scrim: 'rgba(35,32,26,0.45)', header: 'rgba(60,50,30,0.07)',
    text: '#22201c', muted: '#6b6760', dim: '#8b877e', dimmer: '#a9a59b',
    accent: '#c05f38', accentText: '#8f4526', accentFill: 'rgba(192,95,56,0.10)', onAccent: '#ffffff',
    success: '#2f7d32', danger: '#b3261e', dangerText: '#8c1d18',
    nodes: { input: '#dde7f2', ai: '#e6dcf0', code: '#dcecdf', data: '#d8eaea', output: '#f3e3cb', gui: '#eedbe6' },
  },
  {
    id: 'graphite',
    label: 'Graphit — neutral dunkel',
    sunken: '#111113', surface: '#1b1b1f', line: '#33333a',
    raise: 'rgba(255,255,255,0.04)', hover: 'rgba(255,255,255,0.07)',
    scrim: 'rgba(0,0,0,0.70)', header: 'rgba(0,0,0,0.35)',
    text: '#e8e8ea', muted: '#a1a1a8', dim: '#79797f', dimmer: '#57575d',
    accent: '#2dd4bf', accentText: '#5eead4', accentFill: 'rgba(45,212,191,0.12)', onAccent: '#06231f',
    success: '#34d399', danger: '#f87171', dangerText: '#fca5a5',
    nodes: { input: '#1d2f36', ai: '#2a2435', code: '#1e3228', data: '#1c3234', output: '#342819', gui: '#35232f' },
  },
];

export function scheme(id: string | undefined): Scheme {
  return SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];
}

/**
 * The scheme as CSS variables, set on the app shell and on a deployed page.
 *
 * Variables rather than props threaded through the tree: a component asks
 * `ui/theme.ts` for SURFACE and needs to know nothing about schemes, which is
 * what let one switch repaint every panel, border and accent in the editor
 * without touching a single call site.
 */
export function schemeVars(id: string | undefined): React.CSSProperties {
  const s = scheme(id);
  return {
    '--ui-sunken': s.sunken,
    '--ui-surface': s.surface,
    '--ui-line': s.line,
    '--ui-raise': s.raise,
    '--ui-hover': s.hover,
    '--ui-scrim': s.scrim,
    '--ui-header': s.header,
    '--ui-text': s.text,
    '--ui-muted': s.muted,
    '--ui-dim': s.dim,
    '--ui-dimmer': s.dimmer,
    '--ui-accent': s.accent,
    '--ui-accent-text': s.accentText,
    '--ui-accent-fill': s.accentFill,
    '--ui-on-accent': s.onAccent,
    '--ui-success': s.success,
    '--ui-danger': s.danger,
    '--ui-danger-text': s.dangerText,
    '--ui-node-input': s.nodes.input,
    '--ui-node-ai': s.nodes.ai,
    '--ui-node-code': s.nodes.code,
    '--ui-node-data': s.nodes.data,
    '--ui-node-output': s.nodes.output,
    '--ui-node-gui': s.nodes.gui,
    // Scrollbars, form controls and the window's own backdrop follow, so a
    // light scheme is light to the edges instead of a light page on a dark desk.
    colorScheme: s.light ? 'light' : 'dark',
  } as React.CSSProperties;
}
