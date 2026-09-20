import React from 'react';
import type { ExecutionResult, GraphNode, GuiWidget } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { BLOCKS } from './blocks';
import { useContainerCell } from './useContainerCell';
import { blockStyle, gridStyle, resolveWidgetLayout, type WidgetPlacement } from './layout';
import { toneIsBare, toneStyle, type Tone } from './tone';
import { schemeVars } from './scheme';
import { DANGER, MUTED } from '@/ui/theme';
import { showsPage, widgetFiresRun } from '@/elements/nodes/gui/guiWidgets';
import type { RunTrigger } from '@/api/client';

/**
 * The page a graph shows: every gui node's blocks, in graph order, on one grid.
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
 * A gui node is a *part* of the interface, not an interface of its own — the
 * same relation a widget already has to its node. Hence one page for the graph,
 * not one window per node.
 */

export interface SurfaceBlock {
  node: GraphNode;
  widget: GuiWidget;
}

/** The gui nodes contributing to the page, in graph order. */
export function useGuiNodes(): GraphNode[] {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  return rfNodes
    .map((n) => n.data.graphNode as GraphNode)
    .filter((n) => showsPage(n.node_type));
}

/** Every block on the page, with the node that owns it. */
export function useSurfaceBlocks(): SurfaceBlock[] {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  return rfNodes
    .map((n) => n.data.graphNode as GraphNode)
    .filter((n) => showsPage(n.node_type))
    .flatMap((node) => node.config.gui_widgets.map((widget) => ({ node, widget })));
}

/**
 * What a block currently holds.
 *
 * `incoming` is what the last run delivered to its input port; the widget's own
 * value is what it stores, including an edit still being typed. They are kept
 * apart so that a widget which both shows and accepts text does not overwrite
 * the reply the user is reading.
 */
export function blockValue(
  block: SurfaceBlock,
  incoming: unknown,
  overrides?: Record<string, string>,
): unknown {
  const own = overrides?.[block.widget.id] ?? block.widget.value ?? '';
  if (BLOCKS[block.widget.kind]?.ownsValue) return own;
  return incoming !== undefined && overrides?.[block.widget.id] === undefined ? incoming : own;
}

/**
 * What a run put on one block: the engine's `display`, which is what arrived
 * *through the block's own transform*. A server from before `display` existed
 * answers without one, and then what arrived is the best there is.
 */
export function shownOn(result: ExecutionResult | null, nodeId: string, widgetId: string): unknown {
  const ran = result?.node_results.find((r) => r.node_id === nodeId);
  const shown = ran?.display?.[widgetId];
  return shown !== undefined ? shown : ran?.inputs?.[`${widgetId}_in`];
}

/** The grid the page flows on: 16 square columns, capped at a readable width. */
export function PageGrid({
  children, minRows, gridRef, onCell,
}: {
  children: React.ReactNode;
  /** Keep this much height when empty, so there is a page to aim at. */
  minRows?: number;
  gridRef?: React.MutableRefObject<HTMLDivElement | null>;
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
      ref={(node) => {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (gridRef) gridRef.current = node;
      }}
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
export default function GuiPage({
  blocks, onWidgetValue, onWidgetTrigger,
}: {
  blocks: SurfaceBlock[];
  onWidgetValue: (block: SurfaceBlock, value: unknown) => void;
  onWidgetTrigger?: (block: SurfaceBlock, value?: unknown) => void;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const busy = useGraphStore((s) => s.isExecuting);
  const placements = resolveWidgetLayout(blocks.map((b) => b.widget));

  return (
    <PageGrid>
      {placements.map((placement, index) => {
        const block = blocks[index];
        const incoming = shownOn(executionResult, block.node.id, placement.widget.id);
        return (
          <GuiBlock
            key={placement.widget.id}
            placement={placement}
            incoming={incoming}
            value={blockValue(block, incoming)}
            onChange={(next) => onWidgetValue(block, next)}
            onTrigger={onWidgetTrigger ? (next) => onWidgetTrigger(block, next) : undefined}
            busy={busy}
          />
        );
      })}
    </PageGrid>
  );
}

/**
 * The page wired to the graph: what a deployed tool serves, and what the
 * editor's preview tab shows. One component, so a preview cannot flatter.
 */
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
  const updateNode = useGraphStore((s) => s.updateNode);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const runGraph = useGraphStore((s) => s.runGraph);

  const setWidgetValue = (block: SurfaceBlock, value: unknown) => {
    // Read from the store, not from `block`: a value and the event that
    // follows it arrive in the same tick, and the block in hand is the one
    // from before either.
    const current = useGraphStore.getState().rfNodes.find((n) => n.id === block.node.id)?.data.graphNode as GraphNode | undefined;
    const config = current?.config ?? block.node.config;
    updateNode(block.node.id, {
      config: {
        ...config,
        gui_widgets: config.gui_widgets.map(
          (w) => (w.id === block.widget.id ? { ...w, value } : w),
        ),
      },
    });
  };

  /**
   * A block was used. If it is one that starts the graph, start it -- where the
   * block is wired to, which is the engine's question to answer, not the page's.
   */
  const fire = (block: SurfaceBlock, value?: unknown) => {
    if (value !== undefined) setWidgetValue(block, value);
    if (!widgetFiresRun(block.widget)) return;
    if (useGraphStore.getState().isExecuting) return;
    const trigger: RunTrigger = { node_id: block.node.id, port_id: `${block.widget.id}_out` };
    if (onRun) onRun(trigger);
    else void runGraph(exportGraph(), trigger);
  };

  return { setWidgetValue, fire };
}

export function GuiSurfacePage({ onRun }: {
  /**
   * Start a run for a page event. The host supplies it because the host is who
   * knows what has to happen first -- asking for a file nobody chose yet, say --
   * and that must be the same whether ▶ Run or a button on the page asked.
   * Without one, the store's plain `runGraph` is used.
   */
  onRun?: (trigger: RunTrigger) => void;
}) {
  const blocks = useSurfaceBlocks();
  const { setWidgetValue, fire } = usePageEvents(onRun);

  if (blocks.length === 0) return null;
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <GuiPage blocks={blocks} onWidgetValue={setWidgetValue} onWidgetTrigger={fire} />
    </div>
  );
}
