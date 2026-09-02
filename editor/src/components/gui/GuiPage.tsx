import React from 'react';
import type { GraphNode, GuiWidget } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { NODE_ELEMENTS, GUI_WIDGET_ELEMENTS } from '../../elements/registry';
import { useContainerCell } from './useContainerCell';
import { blockStyle, gridStyle, resolveWidgetLayout, type WidgetPlacement } from './layout';
import { toneIsBare, toneStyle, type Tone } from './tone';
import { schemeVars } from './scheme';
import { DANGER, MUTED } from '../../ui/theme';

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
    .filter((n) => NODE_ELEMENTS[n.node_type]?.hasRuntimeWindow);
}

/** Every block on the page, with the node that owns it. */
export function useSurfaceBlocks(): SurfaceBlock[] {
  const rfNodes = useGraphStore((s) => s.rfNodes);
  return rfNodes
    .map((n) => n.data.graphNode as GraphNode)
    .filter((n) => NODE_ELEMENTS[n.node_type]?.hasRuntimeWindow)
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
  return incoming !== undefined && overrides?.[block.widget.id] === undefined ? incoming : own;
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
  placement, value, incoming, onChange, style, onMouseDown, blockRef, labelInset, children,
}: {
  placement: WidgetPlacement;
  value: unknown;
  incoming: unknown;
  onChange: (next: string) => void;
  style?: React.CSSProperties;
  onMouseDown?: (event: React.MouseEvent) => void;
  blockRef?: (element: HTMLElement | null) => void;
  /** Room for a drag grip beside the caption. Designer only. */
  labelInset?: number;
  children?: React.ReactNode;
}) {
  const { widget } = placement;
  const RuntimeWidget = GUI_WIDGET_ELEMENTS[widget.kind]?.RuntimeWidget;
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
        {RuntimeWidget ? (
          <RuntimeWidget widget={widget} value={value} incoming={incoming} onChange={onChange} />
        ) : (
          <span className="text-xs" style={{ color: DANGER }}>Unbekannte Art: {widget.kind}</span>
        )}
      </div>
    </div>
  );
}

/** The page itself: what a deployed tool renders, and what the preview shows. */
export default function GuiPage({
  blocks, onWidgetValue,
}: {
  blocks: SurfaceBlock[];
  onWidgetValue: (block: SurfaceBlock, value: string) => void;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const placements = resolveWidgetLayout(blocks.map((b) => b.widget));

  return (
    <PageGrid>
      {placements.map((placement, index) => {
        const block = blocks[index];
        const incoming = executionResult?.node_results
          .find((r) => r.node_id === block.node.id)?.inputs?.[`${placement.widget.id}_in`];
        return (
          <GuiBlock
            key={placement.widget.id}
            placement={placement}
            incoming={incoming}
            value={blockValue(block, incoming)}
            onChange={(next) => onWidgetValue(block, next)}
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
export function GuiSurfacePage() {
  const updateNode = useGraphStore((s) => s.updateNode);
  const blocks = useSurfaceBlocks();

  const setWidgetValue = (block: SurfaceBlock, value: string) => {
    updateNode(block.node.id, {
      config: {
        ...block.node.config,
        gui_widgets: block.node.config.gui_widgets.map(
          (w) => (w.id === block.widget.id ? { ...w, value } : w),
        ),
      },
    });
  };

  if (blocks.length === 0) return null;
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <GuiPage blocks={blocks} onWidgetValue={setWidgetValue} />
    </div>
  );
}
