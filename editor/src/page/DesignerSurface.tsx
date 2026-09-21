import React from 'react';
import type { GuiWidget } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { blockValue, GuiBlock, PageGrid, shownOn, type SurfaceBlock } from './GuiPage';
import { cellsFromDrag, resolveWidgetLayout, GUI_GAP, GUI_GRID_COLUMNS, GUI_MAX_CELL } from '@/document/layout';
import QuickInsert from './QuickInsert';
import type { PaletteEntry } from './DesignerPalette';
import { TEXT_ROLES, textRole } from '@/elements/widgets/text/TextWidgetView';
import { widgetFiresRun } from '@/document/guiWidgets';
import { ACCENT, DIMMER, LINE, MUTED, SURFACE, TEXT } from '@/ui/theme';

/**
 * The page, plus the few affordances needed to build one.
 *
 * Everything a *user* sees comes from `GuiPage.tsx` — the same grid, the same
 * blocks, the same widgets the deployed tool renders. What is added here is
 * only what a builder needs, and it is modelled on a document editor rather
 * than a layout tool, because a document is what a page is:
 *
 *  - **words are typed where they stand.** A heading is edited by clicking it
 *    and typing, not by selecting it and finding a box in a side panel;
 *  - **`/` inserts.** Type what you want, Enter, carry on;
 *  - **a block's size is a fraction of the page** — ¼ ½ ¾ Full — on a small
 *    toolbar over the selected block, which also moves and removes it. The grid
 *    underneath still counts cells, and the corner can still be dragged to any
 *    of them; nobody has to know that to get two things side by side.
 *
 * None of it is reachable from the runtime entry point, which is the whole
 * point of the split (see the note at the top of GuiPage.tsx).
 *
 * The blocks stay **live** while you design: you can type into a field and
 * press ▶ and watch the same blocks fill, because designing and using are the
 * same page.
 */
export default function DesignerSurface({
  blocks, onChange, onWidgetValue, onWidgetTrigger, selectedId, onSelect, overrides, dropIndex,
  insertAt, onInsertAt, onInsert,
}: {
  blocks: SurfaceBlock[];
  /** The whole page, rewritten. The caller routes each block back to its node. */
  onChange: (widgets: GuiWidget[]) => void;
  onWidgetValue: (block: SurfaceBlock, value: unknown) => void;
  /** A block was used: the same event the delivered page gets, because the blocks here are live. */
  onWidgetTrigger: (block: SurfaceBlock, value?: unknown) => void;
  selectedId: string | null;
  onSelect: (widgetId: string | null) => void;
  overrides?: Record<string, string>;
  /** Where a palette drag in flight would land. */
  dropIndex?: number | null;
  /** Where the `/` menu is open, as an index into the page; null when it is not. */
  insertAt: number | null;
  onInsertAt: (index: number | null) => void;
  onInsert: (entry: PaletteEntry, index: number) => void;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const busy = useGraphStore((s) => s.isExecuting);
  // Reported by the grid below, because only the grid element knows it.
  const [cell, setCell] = React.useState(GUI_MAX_CELL);
  const placements = resolveWidgetLayout(blocks.map((b) => b.widget));

  const widgets = blocks.map((b) => b.widget);
  const widgetsRef = React.useRef(widgets);
  widgetsRef.current = widgets;

  const patch = (widgetId: string, change: Partial<GuiWidget>) =>
    onChange(widgetsRef.current.map((w) => (w.id === widgetId ? { ...w, ...change } : w)));

  const move = (widgetId: string, delta: -1 | 1) => {
    const from = widgetsRef.current.findIndex((w) => w.id === widgetId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= widgetsRef.current.length) return;
    const next = [...widgetsRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const remove = (widgetId: string) => {
    onChange(widgetsRef.current.filter((w) => w.id !== widgetId));
    onSelect(null);
  };

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
      patch(state.id, {
        w: Math.max(1, Math.min(GUI_GRID_COLUMNS, state.w + cellsFromDrag(event.clientX - state.x, cell))),
        h: Math.max(1, state.h + cellsFromDrag(event.clientY - state.y, cell)),
      });
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
      <PageGrid minRows={4} onCell={setCell}>
        {placements.map((placement, index) => {
          const block = blocks[index];
          const { widget } = placement;
          const incoming = shownOn(executionResult, block.node.id, widget.id);
          const selected = widget.id === selectedId;
          const typedInPlace = selected && WIDGET_BUILDERS[widget.kind]?.inlineText === true;

          return (
            <React.Fragment key={widget.id}>
              {dropIndex === index && <InsertionLine />}
              {insertAt === index && (
                <QuickInsert onPick={(entry) => onInsert(entry, index)} onClose={() => onInsertAt(null)} />
              )}
              <GuiBlock
                placement={placement}
                incoming={incoming}
                value={blockValue(block, incoming, overrides)}
                onChange={(next) => onWidgetValue(block, next)}
                onTrigger={(next) => onWidgetTrigger(block, next)}
                busy={busy}
                blockRef={(element) => {
                  if (element) blockRefs.current.set(widget.id, element);
                  else blockRefs.current.delete(widget.id);
                }}
                labelInset={16}
                // The toolbar hangs above the block, outside its box.
                style={{
                  outline: selected ? `2px solid ${ACCENT}` : 'none',
                  outlineOffset: 1,
                  opacity: draggingId === widget.id ? 0.55 : 1,
                  overflow: selected ? 'visible' : undefined,
                  zIndex: selected ? 5 : undefined,
                }}
                onMouseDown={(e) => { e.stopPropagation(); onSelect(widget.id); }}
                content={typedInPlace ? (
                  <InPlaceText
                    widget={widget}
                    cell={cell}
                    rows={placement.h}
                    onText={(value) => patch(widget.id, { value })}
                    onRows={(h) => patch(widget.id, { h })}
                  />
                ) : undefined}
              >
                {selected && (
                  <BlockToolbar
                    width={placement.w}
                    onWidth={(w) => patch(widget.id, { w })}
                    onTaller={() => patch(widget.id, { h: placement.h + 1 })}
                    onShorter={() => patch(widget.id, { h: Math.max(1, placement.h - 1) })}
                    onUp={index > 0 ? () => move(widget.id, -1) : undefined}
                    onDown={index < placements.length - 1 ? () => move(widget.id, 1) : undefined}
                    onInsertBelow={() => onInsertAt(index + 1)}
                    onRemove={() => remove(widget.id)}
                  />
                )}

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
                  title="Drag to move"
                  className="absolute select-none flex items-center justify-center"
                  style={{
                    left: 0, top: 0, bottom: 0, width: 14, color: MUTED, fontSize: 12,
                    cursor: draggingId === widget.id ? 'grabbing' : 'grab',
                    opacity: selected || draggingId === widget.id ? 0.9 : 0.3,
                  }}
                >
                  ⠿
                </div>

                {/* Which blocks *start* the tool, seen without opening any of
                    them. A page is mostly fields that are read when something
                    else starts a run; the one or two that start it are the
                    whole shape of how the tool is used, and they were
                    indistinguishable until you selected each block in turn.
                    Builder's chrome: the delivered page draws no badge. */}
                {widgetFiresRun(widget) && (
                  <span
                    className="absolute select-none pointer-events-none"
                    style={{ right: 3, top: 2, fontSize: 10, color: '#fbbf24' }}
                    title="Using this block starts the graph"
                    aria-hidden="true"
                  >
                    ⚡
                  </span>
                )}

                <div
                  className="absolute"
                  style={{
                    right: 0, bottom: 0, width: 12, height: 12, background: ACCENT, cursor: 'nwse-resize',
                    opacity: selected ? 1 : 0, borderRadius: '3px 0 6px 0',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelect(widget.id);
                    resize.current = { id: widget.id, x: e.clientX, y: e.clientY, w: placement.w, h: placement.h };
                  }}
                  title="Drag to any size"
                />
              </GuiBlock>
            </React.Fragment>
          );
        })}
        {dropIndex != null && dropIndex >= placements.length && <InsertionLine />}
        {insertAt != null && insertAt >= placements.length && (
          <QuickInsert onPick={(entry) => onInsert(entry, placements.length)} onClose={() => onInsertAt(null)} />
        )}
        {insertAt == null && (
          <button
            type="button"
            className="rounded-lg text-sm text-left px-3"
            style={{ gridColumn: 'span 16', height: 36, color: DIMMER, border: `1px dashed ${LINE}`, background: 'transparent' }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onInsertAt(placements.length)}
          >
            ＋ Add a block — or press <kbd>/</kbd>
          </button>
        )}
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

/** Fractions of the page, in the grid's own cells. Sixteen columns make quarters exact. */
const WIDTHS: { label: string; title: string; w: number }[] = [
  { label: '¼', title: 'A quarter of the page', w: 4 },
  { label: '½', title: 'Half the page', w: 8 },
  { label: '¾', title: 'Three quarters', w: 12 },
  { label: 'Full', title: 'The whole width', w: GUI_GRID_COLUMNS },
];

/**
 * What you do to a block, on the block.
 *
 * Size, order, a neighbour, the bin — the four things that were a number field,
 * a keyboard shortcut, a trip to the palette and a button in a side panel.
 */
function BlockToolbar({
  width, onWidth, onTaller, onShorter, onUp, onDown, onInsertBelow, onRemove,
}: {
  width: number;
  onWidth: (w: number) => void;
  onTaller: () => void;
  onShorter: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onInsertBelow: () => void;
  onRemove: () => void;
}) {
  const button = (active = false): React.CSSProperties => ({
    padding: '2px 7px', borderRadius: 5, fontSize: 12, lineHeight: '18px',
    color: active ? '#fff' : TEXT, background: active ? ACCENT : 'transparent',
  });
  const gap = <span style={{ width: 1, alignSelf: 'stretch', background: LINE, margin: '2px 3px' }} />;

  return (
    <div
      className="absolute flex items-center rounded-lg shadow-lg select-none"
      // Right-aligned: what is above a block is usually words, and words start
      // on the left -- a toolbar over the left edge sat exactly on the heading
      // someone had just typed.
      style={{ right: 0, top: -34, height: 28, padding: '0 4px', background: SURFACE, border: `1px solid ${LINE}`, zIndex: 20, whiteSpace: 'nowrap' }}
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
    >
      {WIDTHS.map((option) => (
        <button key={option.w} type="button" style={button(width === option.w)} title={option.title} onClick={() => onWidth(option.w)}>
          {option.label}
        </button>
      ))}
      {gap}
      <button type="button" style={button()} title="Shorter" onClick={onShorter}>−</button>
      <span style={{ fontSize: 11, color: MUTED }}>height</span>
      <button type="button" style={button()} title="Taller" onClick={onTaller}>＋</button>
      {gap}
      <button type="button" style={{ ...button(), opacity: onUp ? 1 : 0.3 }} title="Move up (Ctrl+↑)" onClick={onUp} disabled={!onUp}>↑</button>
      <button type="button" style={{ ...button(), opacity: onDown ? 1 : 0.3 }} title="Move down (Ctrl+↓)" onClick={onDown} disabled={!onDown}>↓</button>
      {gap}
      <button type="button" style={button()} title="Add a block below (/)" onClick={onInsertBelow}>＋ block</button>
      {gap}
      <button type="button" style={{ ...button(), color: '#f87171' }} title="Remove (Del)" onClick={onRemove} aria-label="Remove block">🗑</button>
    </div>
  );
}

/**
 * A heading or a paragraph, typed where it stands.
 *
 * The box grows with what is written — rows are added as the text needs them,
 * never taken away, so a size someone chose on purpose stays chosen.
 */
function InPlaceText({ widget, cell, rows, onText, onRows }: {
  widget: GuiWidget;
  cell: number;
  rows: number;
  onText: (value: string) => void;
  onRows: (rows: number) => void;
}) {
  const box = React.useRef<HTMLTextAreaElement | null>(null);
  const role = TEXT_ROLES[textRole(widget.mode)];

  React.useEffect(() => {
    const element = box.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    // Once, on entering the block: focus follows selection, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id]);

  const fit = (element: HTMLTextAreaElement) => {
    const needed = Math.ceil((element.scrollHeight + 6 + GUI_GAP) / (cell + GUI_GAP));
    if (needed > rows) onRows(needed);
  };

  return (
    <textarea
      ref={box}
      className="w-full h-full resize-none bg-transparent outline-none"
      style={{ ...role, border: 'none', padding: 0, fontFamily: 'inherit', lineHeight: 1.45 }}
      value={typeof widget.value === 'string' ? widget.value : ''}
      onChange={(event) => { onText(event.target.value); fit(event.target); }}
      onMouseDown={(event) => event.stopPropagation()}
      placeholder={textRole(widget.mode) === 'heading' ? 'Heading' : 'Write something… Markdown works: **bold**, lists, links'}
      spellCheck
    />
  );
}
