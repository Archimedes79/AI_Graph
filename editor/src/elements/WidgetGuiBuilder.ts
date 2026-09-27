// A widget's build-time half, in the browser: the mirror of `engine/src/elements/WidgetRunner.ts`.

import type { ComponentType, ReactNode } from 'react';
import type { GuiWidget, WidgetKind } from '@/graph';
import type { FieldAccess } from '@/authoring/generation';
import type { TryResult } from '@/authoring/TryItInline';
import { DEFAULT_WIDGET_SPAN } from '@/document/layout';
import type { Tone } from '@/ui/tone';
import { ElementGuiBuilder } from './ElementGuiBuilder';

/**
 * What only the shell can hand a panel laid out in the four steps: the page
 * the block sits on, and the page it is drawn in. The panel places each where
 * its step is.
 */
export interface WidgetSteps {
  /** What is wired into the block, in words -- `"Rows" (port "rows")` -- or '' while nothing is. */
  feeds: string;
  /** ⟳ From the graph: what arrives at the block -- on the last run, else from what feeds it, run now. Absent for a block nothing can feed. */
  fromGraph?: () => Promise<{ values: Record<string, unknown>; said: string }>;
  /** The block run by itself on *values*, the way a run runs it. */
  tryIt: (values: Record<string, unknown>) => Promise<TryResult>;
  /** What came out, drawn by the block itself, at its own proportions. */
  renderResult: (result: TryResult) => ReactNode;
  /** "What ✨ sends", beside ✨, and what it sends, under it. */
  preview?: ReactNode;
  sent?: ReactNode;
  /** "Open in my editor", under the body, in a project. */
  openInEditor?: ReactNode;
}

/** What the widget editor hands every widget panel. */
export interface WidgetPanelProps {
  /** This widget kind's own builder. */
  builder: WidgetGuiBuilder;
  widget: GuiWidget;
  onUpdate: (patch: Partial<GuiWidget>) => void;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  /** For a block that authors a body: see `WidgetSteps`. */
  steps?: WidgetSteps;
}

let created = 0;

export abstract class WidgetGuiBuilder extends ElementGuiBuilder<GuiWidget, WidgetPanelProps> {
  // ── What it is ────────────────────────────────────────────────────────────

  abstract readonly widgetKind: WidgetKind;

  // ── Run time ──────────────────────────────────────────────────────────────
  // Nothing, on purpose. What a deployed tool draws a block with is not a
  // member here at all: it is `page/blocks.ts`, a module of its own, which is
  // what keeps this class out of the bundle a recipient downloads rather than
  // merely uncalled in it.

  // ── Build time ────────────────────────────────────────────────────────────
  // The editor: the palette, a new element, its panels, what ✨ Generate is told.
  // Nothing else, and now nothing a tool can reach (`runtime/boundary.test.ts`).

  /** What the palette and the properties header call it. */
  abstract readonly label: string;

  /** The mode a new widget of this kind starts in, when the palette names none. */
  readonly defaultMode: string = '';

  /**
   * The widget *is* its text: a heading, a paragraph. Selected on the page
   * being built, it becomes a box to type in, where the words stand.
   */
  readonly inlineText?: boolean;

  /**
   * Drawn on the canvas under the widget's input port: what last arrived
   * there, as the block shows it. Handed the block too, because what it shows
   * can be its own code's work -- a chart's draw() -- and not what arrived.
   */
  readonly CanvasPreview?: ComponentType<{ widget: GuiWidget; data: unknown }>;

  /** Said under "⚡ Using this starts the graph", for a widget that can be told to. */
  readonly runOnChangeHint: string =
    'Choosing a value runs the nodes this widget is wired to, and what follows from them — not the whole graph.';

  /** The widget is a source whose data nothing describes yet: see `NodeGuiBuilder.missingExample`. */
  missingExample(_widget: GuiWidget): boolean {
    return false;
  }

  /** What a new widget of this kind is called when the palette puts it on a page: the palette's word for it. */
  initialLabel(paletteLabel: string): string {
    return paletteLabel;
  }

  /**
   * A new widget of this kind, as the palette puts it on a page: the
   * counterpart of `NODE_KINDS[type].create` (document/nodeKinds.ts). No position -- the order of the list is the
   * position, so a new widget simply goes last.
   *
   * What every block has, and then what this kind keeps (`initialSettings`).
   * Every kind's settings used to be spread onto every block, so a divider was
   * saved with a folder selector's code, an options list and an example file,
   * and graph.json carried settings no runner of that kind reads.
   */
  create(label = '', mode = this.defaultMode): GuiWidget {
    created += 1;
    return {
      id: `widget-${created}-${Date.now()}`,
      kind: this.widgetKind,
      label,
      ...(mode ? { mode } : {}),
      ...this.defaultSpan(mode),
      tone: this.defaultTone(mode),
      ...this.initialSettings(),
    };
  }

  /** A sensible first size, so a new widget never lands absurdly shaped. */
  protected defaultSpan(_mode: string): { w: number; h: number } {
    return DEFAULT_WIDGET_SPAN;
  }

  /**
   * A sensible first appearance. Only what you *operate* gets a frame: a box
   * around a heading or a chart is a box around something with a shape of its
   * own, while a field you type into has to look like a field or nobody
   * clicks it. A default, not a rule: the tone is yours to change.
   */
  protected defaultTone(_mode: string): Tone {
    return 'plain';
  }

  /** What a new widget of this kind holds beyond the common fields, and only what it reads: a dropdown's first options. */
  protected initialSettings(): Partial<GuiWidget> {
    return {};
  }

}
