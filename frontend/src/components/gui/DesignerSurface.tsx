import React from 'react';
import type { GuiWidget } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { blockValue, GuiBlock, PageGrid, type SurfaceBlock } from './GuiPage';
import { resolveWidgetLayout, GUI_GRID_COLUMNS } from './layout';
import { useContainerCell } from './useContainerCell';
import { ACCENT, MUTED } from '../../ui/theme';

/**
 * The page, plus the few affordances needed to build one.
 *
 * Everything a *user* sees comes from `GuiPage.tsx` — the same grid, the same
 * blocks, the same widgets the deployed tool renders. What is added here is
 * only what a builder needs: a selection, a grip to reorder by, a corner to
 * resize by, and a line showing where a dragged element will land. None of it
 * is reachable from the runtime entry point, which is the whole point of the
 * split (see the note at the top of GuiPage.tsx).
 *
 * The blocks stay **live** while you design: you can type into a field and
 * press ▶ and watch the same blocks fill, because designing and using are the
 * same page.
 */
export default function DesignerSurface({
  blocks, onChange, onWidgetValue, selectedId, onSelect, overrides, dropIndex,
}: {
  blocks: SurfaceBlock[];
  /** The whole page, rewritten. The caller routes each block back to its node. */
  onChange: (widgets: GuiWidget[]) => void;
  onWidgetValue: (block: SurfaceBlock, value: string) => void;
  selectedId: string | null;
  onSelect: (widgetId: string | null) => void;
  overrides?: Record<string, string>;
  /** Where a palette drag in flight would land. */
  dropIndex?: number | null;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const { cell } = useContainerCell();
  const placements = resolveWidgetLayout(blocks.map((b) => b.widget));

  const widgets = blocks.map((b) => b.widget);
  const widgetsRef = React.useRef(widgets);
  widgetsRef.current = widgets;

  // ---- reorder by dragging ---------------------------------------------------
  //
  // Pointer events, not HTML5 drag-and-drop. That API looks made for this and is
  // not: a `dragstart` inside a block full of live inputs is swallowed as often
  // as it fires, there is no drag image worth having, and none of it can be
  // tested without a real mouse. Tracking the pointer is a dozen lines, works
  // every time, reorders *live* so you see the result while you move — and is
  // what ReactFlow does on the canvas next door.
  const blockRefs = React.useRef(new Map<string, HTMLElement>());
  const dragging = React.useRef<string | null>(null);
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const reorder = (fromId: string, toId: string) => {
    const from = widgetsRef.current.findIndex((w) => w.id === fromId);
    const to = widgetsRef.current.findIndex((w) => w.id === toId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...widgetsRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  // ---- resize: the one thing the grid is still dragged for --------------------
  const resize = React.useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);

  React.useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const held = dragging.current;
      if (held) {
        for (const [id, element] of blockRefs.current) {
          if (id === held) continue;
          const box = element.getBoundingClientRect();
          if (event.clientX >= box.left && event.clientX <= box.right
              && event.clientY >= box.top && event.clientY <= box.bottom) {
            reorder(held, id);
            return;
          }
        }
        return;
      }
      const state = resize.current;
      if (!state) return;
      onChange(widgetsRef.current.map((w) => (w.id === state.id ? {
        ...w,
        w: Math.max(1, Math.min(GUI_GRID_COLUMNS, state.w + Math.round((event.clientX - state.x) / cell))),
        h: Math.max(1, state.h + Math.round((event.clientY - state.y) / cell)),
      } : w)));
    };
    const onUp = () => {
      dragging.current = null;
      resize.current = null;
      setDraggingId(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  return (
    <div onMouseDown={() => onSelect(null)}>
      {/* An empty page is still a page: without a minimum height the grid is
          zero pixels tall and there is nothing to aim a first element at. */}
      <PageGrid minRows={4}>
        {placements.map((placement, index) => {
          const block = blocks[index];
          const { widget } = placement;
          const incoming = executionResult?.node_results
            .find((r) => r.node_id === block.node.id)?.inputs?.[`${widget.id}_in`];
          const selected = widget.id === selectedId;

          return (
            <React.Fragment key={widget.id}>
              {dropIndex === index && <InsertionLine />}
              <GuiBlock
                placement={placement}
                incoming={incoming}
                value={blockValue(block, incoming, overrides)}
                onChange={(next) => onWidgetValue(block, next)}
                blockRef={(element) => {
                  if (element) blockRefs.current.set(widget.id, element);
                  else blockRefs.current.delete(widget.id);
                }}
                labelInset={16}
                style={{
                  outline: selected ? `2px solid ${ACCENT}` : 'none',
                  outlineOffset: 1,
                  opacity: draggingId === widget.id ? 0.55 : 1,
                }}
                onMouseDown={(e) => { e.stopPropagation(); onSelect(widget.id); }}
              >
                {/* The grip, not the block, starts a drag — so the widget stays
                    live and you can type in it while designing. A full-height
                    strip rather than a 14px dot: a grip you have to aim for is
                    not a grip. */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(widget.id);
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

                <div
                  className="absolute"
                  style={{ right: 0, bottom: 0, width: 12, height: 12, background: ACCENT, cursor: 'nwse-resize', opacity: selected ? 1 : 0.3 }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(widget.id);
                    resize.current = { id: widget.id, x: e.clientX, y: e.clientY, w: placement.w, h: placement.h };
                  }}
                  title="Größe ändern"
                />
              </GuiBlock>
            </React.Fragment>
          );
        })}
        {dropIndex != null && dropIndex >= placements.length && <InsertionLine />}
      </PageGrid>
    </div>
  );
}

/**
 * Where a dragged element would land.
 *
 * A grid item of its own, so it sits exactly where the dropped element will —
 * a line drawn over the page would have to re-derive the same position and
 * could disagree with it.
 */
function InsertionLine() {
  return <div style={{ gridColumn: 'span 16', height: 2, background: ACCENT, borderRadius: 2 }} />;
}
