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

/**
 * Every colour is a `var()` into the active scheme (components/gui/scheme.ts),
 * set once on the app shell. The literal after the comma is the default scheme,
 * so anything rendered outside the shell still has a colour rather than none.
 *
 * That indirection is the whole mechanism: a component asks for SURFACE exactly
 * as it did when these were literals, and switching scheme repaints the editor
 * and the designed page together without one call site changing.
 *
 * CSS variables resolve in style *properties* only, never in SVG presentation
 * attributes -- an SVG shape must take these through `style`, not `fill=`.
 */

/** Recessed surfaces: page background, inputs, code areas, dialog headers. */
export const SUNKEN = 'var(--ui-sunken, #0f1117)';
/** Raised surfaces: panels, modals, nodes, floating windows. */
export const SURFACE = 'var(--ui-surface, #1a1d2e)';
/** Borders — and the neutral button fill, which is the same colour by design. */
export const LINE = 'var(--ui-line, #2d3148)';
/** The barely-there lift of a block off the page. */
export const RAISE = 'var(--ui-raise, rgba(255,255,255,0.03))';
/** A row or button under the pointer. */
export const HOVER = 'var(--ui-hover, rgba(255,255,255,0.06))';
/** Behind a modal. */
export const SCRIM = 'var(--ui-scrim, rgba(0,0,0,0.70))';
/** A node's title bar, over the node's own tint. */
export const HEADER = 'var(--ui-header, rgba(0,0,0,0.30))';

export const TEXT = 'var(--ui-text, #e2e8f0)';
/** Labels and secondary text. */
export const MUTED = 'var(--ui-muted, #94a3b8)';
/** Help text under a control. */
export const DIM = 'var(--ui-dim, #64748b)';
/** Hints and disabled-ish detail; the faintest readable step. */
export const DIMMER = 'var(--ui-dimmer, #475569)';

export const ACCENT = 'var(--ui-accent, #6366f1)';
/** Accent-coloured text on a normal surface. */
export const ACCENT_TEXT = 'var(--ui-accent-text, #a5b4fc)';
/** The accent at low opacity: tinted notes, the `accent` tone's fill. */
export const ACCENT_FILL = 'var(--ui-accent-fill, rgba(99,102,241,0.10))';
/** Text on top of the accent itself — a button's label. */
export const ON_ACCENT = 'var(--ui-on-accent, #ffffff)';

export const SUCCESS = 'var(--ui-success, #22c55e)';
export const DANGER = 'var(--ui-danger, #ef4444)';
/** Error text, readable on this scheme's own background. */
export const DANGER_TEXT = 'var(--ui-danger-text, #fca5a5)';
/** Destructive affordance inside an otherwise neutral control. */
export const DANGER_SOFT = 'var(--ui-danger, #f87171)';

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
export const PRIMARY_BUTTON = { background: ACCENT, color: ON_ACCENT } as const;
