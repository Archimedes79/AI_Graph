/**
 * The editor's colour vocabulary, and the few style objects built from it.
 *
 * These values were literals: `#2d3148` appeared 119 times, `#e2e8f0` 98,
 * `#0f1117` 54 — and one field style object was copy-pasted 33 times across 14
 * files. Nothing enforced that they stayed in step, and a designer asking to
 * "make the panels a shade lighter" had no single place to answer.
 *
 * Named by role, not by appearance, so the names stay true if the palette
 * changes. Rare one-off colours (a specific node type's tint, a chart accent)
 * deliberately stay where they are used -- this file is for the chrome that
 * repeats.
 */

/** Recessed surfaces: page background, inputs, code areas, dialog headers. */
export const SUNKEN = '#0f1117';
/** Raised surfaces: panels, modals, nodes, floating windows. */
export const SURFACE = '#1a1d2e';
/** Borders — and the neutral button fill, which is the same colour by design. */
export const LINE = '#2d3148';

export const TEXT = '#e2e8f0';
/** Labels and secondary text. */
export const MUTED = '#94a3b8';
/** Help text under a control. */
export const DIM = '#64748b';
/** Hints and disabled-ish detail; the faintest readable step. */
export const DIMMER = '#475569';

export const ACCENT = '#6366f1';
/** Text/detail on an accent-tinted background. */
export const ACCENT_TEXT = '#a5b4fc';

export const SUCCESS = '#22c55e';
export const DANGER = '#ef4444';
/** Error text on a dark background. */
export const DANGER_TEXT = '#fca5a5';
/** Destructive affordance inside an otherwise neutral control. */
export const DANGER_SOFT = '#f87171';

/** A form control on a panel. The single most copied style object in the app. */
export const FIELD = { background: SUNKEN, color: TEXT, border: `1px solid ${LINE}` } as const;

/** A form control on an already-sunken surface (the widget list's inner cards). */
export const FIELD_ON_SURFACE = { background: SURFACE, color: TEXT, border: `1px solid ${LINE}` } as const;

/** A raised container: modal panel, floating window, widget card. */
export const PANEL = { background: SURFACE, border: `1px solid ${LINE}` } as const;

/** A recessed container: dialog header bars, inner wells. */
export const WELL = { background: SUNKEN, border: `1px solid ${LINE}` } as const;

/** The unemphasised button (Cancel, Move up, secondary toolbar actions). */
export const NEUTRAL_BUTTON = { background: LINE, color: TEXT } as const;

/** The primary action button. */
export const PRIMARY_BUTTON = { background: ACCENT, color: 'white' } as const;
