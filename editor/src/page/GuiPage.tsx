import React from 'react';
import type { ExecutionResult, GraphNode, GuiWidget } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { BLOCKS } from './blocks';
import { useContainerCell } from './useContainerCell';
import { patchBlock } from './pageWrite';
import { blockStyle, gridStyle, resolveWidgetLayout, type WidgetPlacement } from '@/document/layout';
import { toneIsBare, toneStyle, type Tone } from '@/ui/tone';
import { schemeVars } from '@/ui/scheme';
import { DANGER, DIM, MUTED, TEXT } from '@/ui/theme';
import { blockPort, blockShows, pageOf, widgetFiresRun } from '@/document/guiWidgets';
import type { RunTrigger } from '@/api/client';
import RunResult from './RunResult';

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
 * so the boundary has to be a module boundary — and `runtime.boundary.test.ts`
 * asserts that it stays one.
 *
 * A graph is one tool with one page: the first node that carries an interface
 * (the file format calls it `gui`). A second one is a problem `check` names,
 * and nothing draws it.
 */

/**
 * The page -- the node that is the page, none before the first block makes it
 * -- and its blocks, as they were drawn. An edit that lands later reads the
 * page from the store as it is then (`pageWrite.ts`).
 */
export function usePage(): ReturnType<typeof pageOf> {
  return pageOf(useGraphStore((s) => s.rfNodes).map((n) => n.data.graphNode as GraphNode));
}

/**
 * What a block currently holds.
 *
 * `incoming` is what the last run delivered to its input port; the widget's own
 * value is what it stores, including an edit still being typed. They are kept
 * apart so that a widget which both shows and accepts text does not overwrite
 * the reply the user is reading -- and so that what it shows as its value is
 * what a run sends from it: its own (`BlockKind.ownsValue`).
 */
export function blockValue(
  widget: GuiWidget,
  incoming: unknown,
  overrides?: Record<string, string>,
): unknown {
  const own = overrides?.[widget.id] ?? widget.value ?? '';
  if (BLOCKS[widget.kind]?.ownsValue?.(widget)) return own;
  return incoming !== undefined && overrides?.[widget.id] === undefined ? incoming : own;
}

/** What a run put on one block of the page node *nodeId* (`blockShows`). */
export function shownOn(result: ExecutionResult | null, nodeId: string, widget: GuiWidget): unknown {
  return blockShows(result?.node_results.find((r) => r.node_id === nodeId), widget);
}

/** The grid the page flows on: 16 square columns, capped at a readable width. */
export function PageGrid({
  children, minRows, onCell,
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
}) {
  const pageScheme = useGraphStore((s) => s.metadata.gui_scheme);
  const { ref, cell } = useContainerCell();

  React.useEffect(() => { onCell?.(cell); }, [cell, onCell]);

  return (
    <div
      ref={ref}
      data-gui-surface
      style={{
        ...gridStyle(cell),
        ...schemeVars(pageScheme),
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

/** The page itself: what a deployed tool renders, and what the preview shows. */
function GuiPage({
  pageId, widgets, onWidgetValue, onWidgetTrigger,
}: {
  pageId: string;
  widgets: GuiWidget[];
  onWidgetValue: (widget: GuiWidget, value: unknown) => void;
  onWidgetTrigger?: (widget: GuiWidget, value?: unknown) => void;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const busy = useGraphStore((s) => s.isExecuting);
  const placements = resolveWidgetLayout(widgets);

  return (
    <PageGrid>
      {placements.map((placement) => {
        const { widget } = placement;
        const incoming = shownOn(executionResult, pageId, widget);
        return (
          <GuiBlock
            key={widget.id}
            placement={placement}
            incoming={incoming}
            value={blockValue(widget, incoming)}
            onChange={(next) => onWidgetValue(widget, next)}
            onTrigger={onWidgetTrigger ? (next) => onWidgetTrigger(widget, next) : undefined}
            busy={busy}
          />
        );
      })}
    </PageGrid>
  );
}

/**
 * What using a block does: keep its value, and start the graph if it is a
 * block that starts it.
 *
 * One implementation, for the delivered page and for the page being built. The
 * designer used to pass no event at all, on the theory that a page being laid
 * out must not start runs -- so on the Page tab a chat's Send did nothing and a
 * button was a picture of a button, on the very surface whose promise is that
 * its blocks are live.
 */
export function usePageEvents(onRun?: (trigger: RunTrigger) => void) {
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const runGraph = useGraphStore((s) => s.runGraph);

  // Through `pageWrite`, as every edit of the page: a value and the event that
  // follows it arrive in the same tick, and the page in hand is the one from
  // before either.
  const setWidgetValue = (widget: GuiWidget, value: unknown) => patchBlock(widget.id, { value });

  /**
   * A block was used. If it is one that starts the graph, start it -- where the
   * block is wired to, which is the engine's question to answer, not the page's.
   */
  const fire = (widget: GuiWidget, value?: unknown) => {
    if (value !== undefined) setWidgetValue(widget, value);
    const { page } = pageOf(useGraphStore.getState().rfNodes.map((n) => n.data.graphNode as GraphNode));
    const port = blockPort(widget, 'out');
    if (!page || !port || !widgetFiresRun(widget)) return;
    if (useGraphStore.getState().isExecuting) return;
    const trigger: RunTrigger = { node_id: page.id, port_id: port };
    if (onRun) onRun(trigger);
    else void runGraph(exportGraph(), trigger);
  };

  return { setWidgetValue, fire };
}

/**
 * What a tool shows when its page has no blocks: what it does, how to start
 * it, and what its run handed back -- each output node's values under its
 * name. A page is its blocks; a page node whose last block was removed has
 * nothing to draw, and drew an empty rectangle where the run's result belongs.
 */
function WithoutPage() {
  const metadata = useGraphStore((s) => s.metadata);
  const executionResult = useGraphStore((s) => s.executionResult);
  // A graph of nothing is not ready to run: it said it was, run or not.
  const empty = useGraphStore((s) => s.rfNodes.length === 0);
  if (empty) {
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
        {metadata.description || `${metadata.name} is ready to run.`}
      </p>
      <p className="text-xs" style={{ color: DIM }}>
        It runs when it is started. Anything it still needs — a value to start from, a place to
        write — is asked for first, and what it hands back appears here.
      </p>
      <RunResult result={executionResult} />
    </div>
  );
}

/**
 * The page wired to the graph: what a deployed tool serves, and what the
 * editor's running application shows -- or, with no blocks, the tool without a
 * page. One component, so what is tried in the editor cannot flatter.
 */
export function GuiSurfacePage({ onRun }: {
  /**
   * Start a run for a page event. The host supplies it because the host is who
   * knows what has to happen first -- asking for a file nobody chose yet, say --
   * and that must be the same in the editor and in a tool someone was handed.
   * Without one, the store's plain `runGraph` is used.
   */
  onRun?: (trigger: RunTrigger) => void;
}) {
  const { page, widgets } = usePage();
  const { setWidgetValue, fire } = usePageEvents(onRun);

  if (!page || widgets.length === 0) return <WithoutPage />;
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <GuiPage pageId={page.id} widgets={widgets} onWidgetValue={setWidgetValue} onWidgetTrigger={fire} />
    </div>
  );
}
