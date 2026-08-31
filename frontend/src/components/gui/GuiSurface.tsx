import React from 'react';
import type { GraphNode, GuiWidget } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { NODE_ELEMENTS, GUI_WIDGET_ELEMENTS } from '../../elements/registry';
import { useContainerCell } from './useContainerCell';
import { blockStyle, gridStyle, resolveWidgetLayout } from './layout';
import { toneIsBare, toneStyle, type Tone } from './tone';
import { schemeVars } from './scheme';
import { ACCENT, DANGER, MUTED } from '../../ui/theme';

/**
 * The page a graph shows: every gui node's blocks, in graph order, on one grid.
 *
 * **One component, three places** — the designer tab, and the deployed tool's
 * page. It used to be three renderings: grey placeholder boxes in the designer,
 * real widgets in a floating window per gui node, and the same floating windows
 * again in the bundle. Three renderings of one page drift; one rendering shown
 * in three places cannot, which is why designing now predicts running.
 *
 * A gui node is a *part* of the interface, not an interface of its own -- the
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

interface GuiSurfaceProps {
  blocks: SurfaceBlock[];
  /** Written back when a widget's own value changes (typing, picking a file). */
  onWidgetValue: (block: SurfaceBlock, value: string) => void;
  /** Editing chrome: selection outline, drag handle, resize corner. */
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (widgetId: string | null) => void;
  onReorder?: (fromId: string, toId: string) => void;
  onResizeStart?: (widgetId: string, event: React.MouseEvent, w: number, h: number) => void;
  /** Local edits in flight, so typing is not overwritten by the last run. */
  overrides?: Record<string, string>;
  /** Draw an insertion line before this block, for a drag in flight. */
  dropIndex?: number | null;
}

export default function GuiSurface({
  blocks, onWidgetValue, editing = false, selectedId, onSelect, onReorder, onResizeStart, overrides, dropIndex,
}: GuiSurfaceProps) {
  const executionResult = useGraphStore((s) => s.executionResult);
  // One scheme for the whole page, stored with the graph rather than per node.
  const pageScheme = useGraphStore((s) => s.metadata.gui_scheme);
  const { ref, cell } = useContainerCell();
  const placements = resolveWidgetLayout(blocks.map((b) => b.widget));

  // ---- reorder by dragging ---------------------------------------------------
  //
  // Pointer events, not HTML5 drag-and-drop. The API looks made for this and is
  // not: a `dragstart` inside a block full of live inputs is swallowed as often
  // as it fires, there is no drag image worth having, and nothing about it can
  // be tested without a real mouse. Tracking the pointer is a dozen lines, works
  // every time, reorders *live* so you see the result while you move -- and is
  // exactly what ReactFlow does on the graph canvas next door.
  const blockRefs = React.useRef(new Map<string, HTMLElement>());
  const dragging = React.useRef<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!editing) return;
    const onMove = (event: MouseEvent) => {
      const held = dragging.current;
      if (!held) return;
      for (const [id, element] of blockRefs.current) {
        if (id === held) continue;
        const box = element.getBoundingClientRect();
        if (event.clientX >= box.left && event.clientX <= box.right
            && event.clientY >= box.top && event.clientY <= box.bottom) {
          onReorder?.(held, id);
          return;
        }
      }
    };
    const onUp = () => {
      dragging.current = null;
      setDraggingId(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editing, onReorder]);

  return (
    <div
      ref={ref}
      data-gui-surface
      style={{
        ...gridStyle(cell),
        ...schemeVars(pageScheme),
        // An empty page is still a page: without this the grid is zero pixels
        // tall and there is nothing to aim a first element at.
        minHeight: editing ? cell * 4 : undefined,
      }}
      onMouseDown={() => onSelect?.(null)}
    >
      {/* The insertion line sits in the flow as a grid item of its own, so it
          lands exactly where the dropped element will -- a line drawn over the
          page would have to re-derive the same position and could disagree. */}
      {placements.map((placement, index) => {
        const block = blocks[index];
        const { widget } = placement;
        const element = GUI_WIDGET_ELEMENTS[widget.kind];
        const RuntimeWidget = element?.RuntimeWidget;
        const result = executionResult?.node_results.find((r) => r.node_id === block.node.id);
        const incoming = result?.inputs?.[`${widget.id}_in`];
        // What the widget itself holds: the edit in flight, else its stored
        // value. Kept apart from `incoming` so a widget that both shows and
        // accepts text does not overwrite the reply the user is reading.
        const own = overrides?.[widget.id] ?? widget.value ?? '';
        const value = incoming !== undefined && overrides?.[widget.id] === undefined ? incoming : own;
        const bare = toneIsBare(widget.tone as Tone);
        const selected = editing && widget.id === selectedId;

        return (
          <React.Fragment key={widget.id}>
          {dropIndex === index && <InsertionLine />}
          <div
            ref={(element) => {
              if (element) blockRefs.current.set(widget.id, element);
              else blockRefs.current.delete(widget.id);
            }}
            className="relative rounded-lg flex flex-col gap-1 min-w-0 overflow-hidden"
            style={{
              ...blockStyle(placement),
              ...toneStyle(widget.tone as Tone),
              // The same horizontal padding either way: a heading that started
              // 10px left of the box beneath it broke the one thing a document
              // must get right, which is a single left margin.
              padding: bare ? '2px 10px' : '6px 10px',
              outline: selected ? `2px solid ${ACCENT}` : 'none',
              outlineOffset: 1,
              opacity: draggingId === widget.id ? 0.55 : 1,
            }}
            onMouseDown={(e) => { if (editing) { e.stopPropagation(); onSelect?.(widget.id); } }}
          >
            {/* The handle, not the block, starts a drag -- so the widget itself
                stays live and you can type in it while designing. A full-height
                strip rather than a 14px dot: a grip you have to aim for is not
                a grip. */}
            {editing && (
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect?.(widget.id);
                  dragging.current = widget.id;
                  setDraggingId(widget.id);
                }}
                title="Ziehen zum Umsortieren"
                className="absolute select-none flex items-center justify-center"
                style={{
                  left: 0, top: 0, bottom: 0, width: 14, color: MUTED, fontSize: 12,
                  cursor: draggingId === widget.id ? 'grabbing' : 'grab',
                  opacity: selected || draggingId === widget.id ? 0.9 : 0.3,
                }}
              >
                ⠿
              </div>
            )}

            {!bare && widget.label && (
              <span className="text-xs font-medium flex-shrink-0" style={{ color: MUTED, paddingLeft: editing ? 16 : 0 }}>
                {widget.label}
              </span>
            )}

            <div className="flex-1 min-h-0">
              {RuntimeWidget ? (
                <RuntimeWidget
                  widget={widget}
                  value={value}
                  incoming={incoming}
                  onChange={(next) => onWidgetValue(block, next)}
                />
              ) : (
                <span className="text-xs" style={{ color: DANGER }}>Unbekannte Art: {widget.kind}</span>
              )}
            </div>

            {editing && (
              <div
                className="absolute"
                style={{ right: 0, bottom: 0, width: 12, height: 12, background: ACCENT, cursor: 'nwse-resize', opacity: selected ? 1 : 0.3 }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelect?.(widget.id);
                  onResizeStart?.(widget.id, e, placement.w, placement.h);
                }}
                title="Größe ändern"
              />
            )}
          </div>
          </React.Fragment>
        );
      })}
      {dropIndex !== null && dropIndex !== undefined && dropIndex >= placements.length && <InsertionLine />}
    </div>
  );
}

/** Where a dragged element would land: one grid row, full width, accent. */
function InsertionLine() {
  return (
    <div style={{ gridColumn: 'span 16', height: 2, background: ACCENT, borderRadius: 2 }} />
  );
}
