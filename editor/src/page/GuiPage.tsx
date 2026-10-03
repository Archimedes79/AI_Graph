import React from 'react';
import type { GuiWidget } from '@/graph';
import { BLOCKS } from './blocks';
import { useContainerCell } from './useContainerCell';
import { blockStyle, gridStyle, resolveWidgetLayout, type WidgetPlacement } from '@/document/layout';
import { toneIsBare, toneStyle, type Tone } from '@/ui/tone';
import { schemeVars } from '@/ui/scheme';
import { DANGER, DANGER_TEXT, DIM, MUTED, TEXT } from '@/ui/theme';
import { widgetFiresRun } from '@/document/guiWidgets';
import RunResult, { type ShownOutput } from './RunResult';

/**
 * The page a graph shows: its blocks, in order, on one grid.
 *
 * **This module is the deployment boundary.** It holds what a *user* of the
 * finished tool sees and nothing else — no selection, no drag handle, no resize
 * corner. The designer's chrome lives in `DesignerSurface.tsx`, which imports
 * from here and which the runtime entry point cannot reach.
 *
 * That is a deliberate answer to a question with two tempting wrong answers.
 * Editing affordances behind an `editing` flag — what this was — still ship: a
 * flag that is false at runtime leaves dead code in the bundle, not absent
 * code, and the deployed tool was loading the palette, the grip and the
 * properties panel inside a 305 KB chunk it never used. A base class that the
 * runtime extends ships them for the same reason, because the subclass
 * references the base. Only the import graph decides what ends up in a bundle,
 * so the boundary has to be a module boundary — and `runtime/boundary.test.ts`
 * asserts that it stays one.
 *
 * It knows no graph and no store: whoever draws it hands it the page as
 * designed and what is in use -- the delivered tool from the runtime API, the
 * editor from its document and the same API -- and is told what was used.
 */

/** The page as it is drawn: what was designed, and what is in use. */
export interface PageModel {
  name: string;
  description: string;
  scheme: string;
  /** The blocks, as designed. */
  blocks: GuiWidget[];
  /** What a block holds now: what was set, what the session keeps, or its design. */
  valueOf: (block: GuiWidget) => unknown;
  /** What a block shows of what the rounds handed it, by its name; undefined for nothing yet. */
  shownOn: (block: GuiWidget) => unknown;
  /** A round is going: a block that starts one waits. */
  busy: boolean;
  /** Why the last round failed, in its own words; empty when it did not. */
  error: string;
  /** For a page without blocks: what the graph hands back, each output under its label. */
  outputs: ShownOutput[];
  /** The graph has no nodes at all: nothing to run, nothing to show. */
  empty?: boolean;
}

/**
 * What a block currently holds.
 *
 * `incoming` is what the rounds delivered to its input port; the widget's own
 * value is what it holds, including an edit still being typed. They are kept
 * apart so that a widget which both shows and accepts text does not overwrite
 * the reply the user is reading -- and so that what it shows as its value is
 * what a round sends from it: its own (`BlockKind.ownsValue`).
 */
export function blockValue(
  widget: GuiWidget,
  own: unknown,
  incoming: unknown,
  overrides?: Record<string, string>,
): unknown {
  const held = overrides?.[widget.id] ?? own ?? '';
  if (BLOCKS[widget.kind]?.ownsValue?.(widget)) return held;
  return incoming !== undefined && overrides?.[widget.id] === undefined ? incoming : held;
}

/** The grid the page flows on: 16 square columns, capped at a readable width. */
export function PageGrid({
  children, minRows, onCell, scheme,
}: {
  children: React.ReactNode;
  /** Keep this much height when empty, so there is a page to aim at. */
  minRows?: number;
  /**
   * The measured cell size, whenever it changes.
   *
   * Only the grid element knows it -- it comes from that element's own width.
   * A caller that needs it (the resize drag, which converts pixels to cells)
   * used to call `useContainerCell` a second time and never attach its ref, so
   * it silently got the uncapped default instead of the truth: a five-cell drag
   * moved a block four cells, and the further you dragged the further the block
   * fell behind the pointer.
   */
  onCell?: (cell: number) => void;
  /** The page's colour scheme. */
  scheme: string;
}) {
  const { ref, cell } = useContainerCell();

  React.useEffect(() => { onCell?.(cell); }, [cell, onCell]);

  return (
    <div
      ref={ref}
      data-gui-surface
      style={{
        ...gridStyle(cell),
        ...schemeVars(scheme),
        minHeight: minRows ? cell * minRows : undefined,
      }}
    >
      {children}
    </div>
  );
}

/**
 * One block: its place on the grid, its tone, its caption, and the widget.
 *
 * `children` is where the designer hangs its chrome. A deployed tool passes
 * none, and none of that code is in its bundle.
 */
export function GuiBlock({
  placement, value, incoming, onChange, onTrigger, busy, style, onMouseDown, blockRef, labelInset, children, content,
}: {
  placement: WidgetPlacement;
  value: unknown;
  incoming: unknown;
  onChange: (next: unknown) => void;
  /** Absent in the designer: a page being laid out must not start runs. */
  onTrigger?: (value?: unknown) => void;
  busy?: boolean;
  style?: React.CSSProperties;
  onMouseDown?: (event: React.MouseEvent) => void;
  blockRef?: (element: HTMLElement | null) => void;
  /** Room for a drag grip beside the caption. Designer only. */
  labelInset?: number;
  children?: React.ReactNode;
  /**
   * Drawn in place of the block's own widget. Designer only: it is how a
   * heading becomes a box you type in while it is selected. A deployed page
   * passes none, so nothing that edits can be reached from it.
   */
  content?: React.ReactNode;
}) {
  const { widget } = placement;
  const View = BLOCKS[widget.kind]?.View;
  const look = { border: widget.border, background: widget.background };
  const bare = toneIsBare(widget.tone as Tone, look);

  return (
    <div
      ref={blockRef}
      className="relative rounded-lg flex flex-col gap-1 min-w-0 overflow-hidden"
      style={{
        ...blockStyle(placement),
        ...toneStyle(widget.tone as Tone, look),
        // The same horizontal padding either way: a heading that started 10px
        // left of the box beneath it broke the one thing a document must get
        // right, which is a single left margin.
        padding: bare ? '2px 10px' : '6px 10px',
        ...style,
      }}
      onMouseDown={onMouseDown}
    >
      {children}

      {!bare && widget.label && (
        <span className="text-xs font-medium flex-shrink-0" style={{ color: MUTED, paddingLeft: labelInset ?? 0 }}>
          {widget.label}
        </span>
      )}

      <div className="flex-1 min-h-0">
        {content ?? (View ? (
          <View widget={widget} value={value} incoming={incoming} onChange={onChange} onTrigger={onTrigger} busy={busy} />
        ) : (
          <span className="text-xs" style={{ color: DANGER }}>Unknown kind of block: {widget.kind}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * What a tool shows when its page has no blocks: what it does, how to start
 * it, and what its run handed back -- each output under its name. A page is
 * its blocks; a page node whose last block was removed has nothing to draw,
 * and drew an empty rectangle where the run's result belongs.
 */
function WithoutPage({ page }: { page: PageModel }) {
  // A graph of nothing is not ready to run: it said it was, run or not.
  if (page.empty) {
    return (
      <div className="m-6 max-w-2xl">
        <p className="text-sm mb-2" style={{ color: TEXT }}>This graph has no nodes yet.</p>
        <p className="text-xs" style={{ color: DIM }}>
          Add one from the palette on the Graph tab, or a block on the Page tab.
        </p>
      </div>
    );
  }
  return (
    <div className="m-6 max-w-2xl">
      <p className="text-sm mb-2" style={{ color: TEXT }}>
        {page.description || `${page.name} is ready to run.`}
      </p>
      <p className="text-xs" style={{ color: DIM }}>
        It runs when it is started. Anything it still needs — a value to start from, a place to
        write — is asked for first, and what it hands back appears here.
      </p>
      <RunResult outputs={page.outputs} />
    </div>
  );
}

/**
 * Why the last round failed, in the round's own words -- which can be several
 * lines long, and belong above the page rather than squeezed into the header
 * beside its "❌ Failed". Part of what the page shows, so every host draws it:
 * the editor's running application once said only "❌ Failed".
 */
function RunError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <div
      className="mx-6 mt-4 text-sm rounded-lg px-4 py-3 whitespace-pre-wrap"
      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: DANGER_TEXT }}
    >
      {error}
    </div>
  );
}

/**
 * The page in use: what a deployed tool serves, and what the editor's running
 * application shows -- or, with no blocks, the tool without a page. One
 * component, so what is tried in the editor cannot flatter.
 *
 * A block used is *onValue* -- what it now holds -- and, for a block that
 * starts the graph, *onEvent* by its name, once its value is in.
 */
export function GuiSurfacePage({ page, onValue, onEvent }: {
  page: PageModel;
  onValue: (block: GuiWidget, value: unknown) => void;
  onEvent: (block: GuiWidget) => void;
}) {
  if (page.blocks.length === 0) return <><RunError error={page.error} /><WithoutPage page={page} /></>;
  // A block used: what it holds now is kept first -- the value and the event
  // that follows it arrive in the same tick -- and only a block the engine
  // calls an event starts a round, and not while one is going.
  const fire = (block: GuiWidget, value?: unknown) => {
    if (value !== undefined) onValue(block, value);
    if (widgetFiresRun(block) && !page.busy) onEvent(block);
  };
  return (
    <>
      <RunError error={page.error} />
      <div className="flex-1 overflow-auto px-8 py-6">
        <PageGrid scheme={page.scheme}>
          {resolveWidgetLayout(page.blocks).map((placement) => {
            const { widget } = placement;
            const incoming = page.shownOn(widget);
            return (
              <GuiBlock
                key={widget.id}
                placement={placement}
                incoming={incoming}
                value={blockValue(widget, page.valueOf(widget), incoming)}
                onChange={(next) => onValue(widget, next)}
                onTrigger={(next) => fire(widget, next)}
                busy={page.busy}
              />
            );
          })}
        </PageGrid>
      </div>
    </>
  );
}
