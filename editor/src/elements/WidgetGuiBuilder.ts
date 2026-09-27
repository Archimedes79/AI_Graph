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
 * the block sits on. The panel places each where its step is.
 */
export interface WidgetSteps {
  /** The block run by itself, the way a run runs it. */
  tryIt: () => Promise<TryResult>;
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

/** One entry of the page designer's palette: a kind in one of its modes, as a person looks for it. */
export interface PaletteEntry {
  /** Omitted: the kind's `defaultMode`. */
  mode?: string;
  label: string;
  icon: string;
  /** Other words someone might type for this when searching. */
  also?: string;
}

/** What a block typed in where it stands is handed by the page designer (`WidgetGuiBuilder.InlineEditor`). */
export interface InlineEditorProps {
  widget: GuiWidget;
  /** One grid cell's size in pixels, so the box can say how many rows its text needs. */
  cell: number;
  /** The rows the block has now. */
  rows: number;
  onText: (value: string) => void;
  onRows: (rows: number) => void;
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
   * What the page designer's palette offers of this kind: one entry, or one
   * per mode that a person reaches for as a thing of its own -- a heading and
   * a paragraph are both `text`. Where each stands in the palette is the
   * palette's layout (`page/DesignerPalette.tsx`); what it is called, its icon
   * and the words it is found by are the kind's.
   */
  abstract paletteEntries(): readonly PaletteEntry[];

  /**
   * The widget *is* its text: a heading, a paragraph. Selected on the page
   * being built, this takes its place, a box to type in where the words stand.
   */
  readonly InlineEditor?: ComponentType<InlineEditorProps>;

  /** Drawn on the canvas under the widget's input port: what last arrived there, as the block shows it. */
  readonly CanvasPreview?: ComponentType<{ data: unknown }>;

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
