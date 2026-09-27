import { useEffect, useRef, useState } from 'react';
import type { WidgetKind } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import DesignerSurface from './DesignerSurface';
import DesignerPalette, { newBlock, type PaletteEntry } from './DesignerPalette';
import { usePage, usePageEvents, useSurfaceBlocks, type SurfaceBlock } from './GuiPage';
import { insertBlock, moveBlock, patchBlock, removeBlock } from './pageWrite';
import { liveTypedValues } from './typedValues';
import PageHeading from './PageHeading';
import WidgetEditor from './WidgetEditor';
import WhatRuns from '@/elements/fields/WhatRuns';
import { SCHEMES, type SchemeId } from '@/ui/scheme';
import { ACCENT, FIELD_ON_SURFACE, LINE, MUTED, SUNKEN, SURFACE, TEXT } from '@/ui/theme';

/**
 * The graph's page, built on the page itself. One graph, one tool, one page --
 * a bundle's recipient wants a window, not three.
 */
export default function DesignerTab() {
  const updateNode = useGraphStore((s) => s.updateNode);
  const guiScheme = useGraphStore((s) => s.metadata.gui_scheme);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const blocks = useSurfaceBlocks();
  const page = usePage();
  const events = usePageEvents();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // What was typed into a live block, shown in place of what arrived there --
  // for as long as the block still holds it. A run that sent it, or a panel
  // edit that replaced it, ends it (`liveTypedValues`). The value itself is
  // stored as it is typed; this only decides which of the two a block shows.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const overrides = liveTypedValues(typed, blocks);

  const selected = blocks.find((b) => b.widget.id === selectedId)?.widget ?? null;

  // Every change to the page goes through `pageWrite`, which reads it from the
  // store when the change lands: a block's editor may hand its change on long
  // after it was drawn.

  /** Add a block to the page, where it was asked for -- at the end by default. */
  const addWidget = (kind: WidgetKind, mode?: string, at?: number) => {
    const widget = newBlock(kind, mode, blocks.map((b) => b.widget.id));
    insertBlock(widget, at);
    setSelectedId(widget.id);
  };
  // The drop below is wired once per drag, and must add to the page as it is
  // when the mouse comes up, not as it was when the drag began.
  const addWidgetNow = useRef(addWidget);
  addWidgetNow.current = addWidget;

  /**
   * Dragging a new element out of the palette and onto the page.
   *
   * Pointer events rather than HTML5 drag-and-drop, for the same reason the
   * reorder uses them: this way it works inside live inputs, it can be tested,
   * and the element lands **where you let go** instead of always at the end.
   *
   * The drop target is the whole page column, not the grid. The grid is only as
   * tall as its contents, which on an empty page is zero pixels -- so the first
   * element anyone ever tried to drag had to be released on an invisible line,
   * and the gesture looked broken exactly when it mattered most.
   */
  /** Where the `/` menu is open, as a place in the page order. */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [dragEntry, setDragEntry] = useState<PaletteEntry | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /** Where in the page order a release at this point would land. */
  const indexAt = (event: MouseEvent): number | null => {
    const zone = document.querySelector('[data-gui-dropzone]');
    if (!zone) return null;
    const box = zone.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right
        || event.clientY < box.top || event.clientY > box.bottom) return null;
    const grid = zone.querySelector('[data-gui-surface]');
    const children = grid ? [...grid.children] : [];
    for (let i = 0; i < children.length; i += 1) {
      const rect = children[i].getBoundingClientRect();
      // Before the first block whose middle is past the pointer: on a page that
      // flows, "here" means "in front of the thing I am pointing above".
      if (event.clientY < rect.top + rect.height / 2) return i;
    }
    return children.length;
  };

  useEffect(() => {
    if (!dragEntry) return;
    const onMove = (event: MouseEvent) => {
      setDragPoint({ x: event.clientX, y: event.clientY });
      setDropIndex(indexAt(event));
    };
    const onUp = (event: MouseEvent) => {
      const index = indexAt(event);
      setDragEntry(null);
      setDragPoint(null);
      setDropIndex(null);
      if (index !== null) addWidgetNow.current(dragEntry.kind, dragEntry.mode, index);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragEntry, blocks.length]);

  const selectedIndex = blocks.findIndex((b) => b.widget.id === selectedId);

  /** Move the selected block one place along the page. */
  const moveSelected = (delta: -1 | 1) => {
    if (selected) moveBlock(selected.id, selectedIndex + delta);
  };

  const removeSelected = () => {
    if (!selected) return;
    removeBlock(selected.id);
    setSelectedId(null);
  };

  // `/` inserts, Delete removes the selected block, Ctrl+Arrow reorders it. Ignored while a
  // field has focus -- the blocks are live, so typing in a text block would
  // otherwise delete it mid-sentence.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === '/') {
        // After the block in hand, or at the end of the page: where the next
        // thing would go if this were a document, which it is.
        event.preventDefault();
        setInsertAt(selectedIndex === -1 ? blocks.length : selectedIndex + 1);
        return;
      }
      if (!selectedId) return;
      if (event.key === 'Delete') {
        event.preventDefault();
        removeSelected();
      } else if (event.ctrlKey && event.key === 'ArrowUp') {
        event.preventDefault();
        moveSelected(-1);
      } else if (event.ctrlKey && event.key === 'ArrowDown') {
        event.preventDefault();
        moveSelected(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /** A live edit in a widget: remembered locally, and stored on its own node. */
  const setWidgetValue = (block: SurfaceBlock, value: unknown) => {
    // Only text is remembered as an edit in progress; a block that stores
    // something richer holds it itself and has no half-typed state to protect.
    if (typeof value === 'string') setTyped((prev) => ({ ...prev, [block.widget.id]: value }));
    patchBlock(block.widget.id, { value });
  };

  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: SUNKEN }}>
      <DesignerPalette onAdd={addWidget} onDragStart={(entry) => setDragEntry(entry)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <PageHeading nodes={page ? [page] : []} onChange={(nodeId, words) => updateNode(nodeId, words)} />
        <div
          data-gui-dropzone
          className="flex-1 overflow-auto px-8 py-6"
          style={dragEntry ? { outline: `2px dashed ${ACCENT}`, outlineOffset: -6 } : undefined}
        >
          <DesignerSurface
            dropIndex={dragEntry ? dropIndex : null}
            blocks={blocks}
            onWidgetValue={setWidgetValue}
            onWidgetTrigger={(block, value) => {
              if (typeof value === 'string') setTyped((prev) => ({ ...prev, [block.widget.id]: value }));
              events.fire(block, value);
            }}
            selectedId={selectedId}
            onSelect={setSelectedId}
            overrides={overrides}
            insertAt={insertAt}
            onInsertAt={setInsertAt}
            onInsert={(entry, index) => { setInsertAt(null); addWidget(entry.kind, entry.mode, index); }}
          />
        </div>
      </div>

      <aside
        className="overflow-y-auto px-3 py-4"
        style={{ width: 340, background: SURFACE, borderLeft: `1px solid ${LINE}`, flexShrink: 0 }}
      >
        {/* One choice for the whole page, from a closed set -- `tone` says what a
            block is, this says what the tool looks like. Every accent is picked
            to sit on the same surfaces, so no combination can come out wrong. */}
        <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: MUTED }}>
          Colour scheme of the page
        </label>
        <select
          className="w-full rounded-lg px-2 py-1.5 text-sm mb-5"
          style={FIELD_ON_SURFACE}
          value={guiScheme}
          onChange={(e) => setMetadata({ gui_scheme: e.target.value as SchemeId })}
        >
          {SCHEMES.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.label}</option>
          ))}
        </select>

        <h3 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: MUTED }}>
          The selected block
        </h3>
        <WidgetEditor
          widget={selected}
          onChange={(patch) => { if (selected) patchBlock(selected.id, patch); }}
          onRemove={removeSelected}
        />

        {/* A page has no panel of its own -- this is where it is edited -- so
            what runs when it runs is said here, as every other node says it. */}
        {page && <div className="mt-5"><WhatRuns node={page} /></div>}
      </aside>

      {/* The element under the cursor while it is being dragged. Without it the
          only feedback was the result, which on a failed drop is no feedback. */}
      {dragEntry && dragPoint && (
        <div
          className="fixed pointer-events-none rounded-lg px-3 py-1.5 text-sm flex items-center gap-2"
          style={{
            left: dragPoint.x + 12, top: dragPoint.y + 12, zIndex: 60,
            background: SURFACE, border: `1px solid ${ACCENT}`, color: TEXT, opacity: 0.95,
          }}
        >
          <span>{dragEntry.icon}</span>
          <span>{dragEntry.label}</span>
        </div>
      )}
    </div>
  );
}
