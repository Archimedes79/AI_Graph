import React, { useEffect, useState } from 'react';
import type { GraphNode, GuiWidget, GuiWidgetKind } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { syncGuiNodePorts } from '../../utils/guiWidgets';
import GuiDesigner from './GuiDesigner';
import DesignerPalette, { type PaletteEntry } from './DesignerPalette';
import { createGuiWidget } from '../../utils/guiWidgets';
import GuiSurface, { useGuiNodes, useSurfaceBlocks, type SurfaceBlock } from './GuiSurface';
import GuiWidgetProperties from '../GuiWidgetEditor';
import { SCHEMES, type SchemeId } from './scheme';
import { ACCENT, DIMMER, FIELD_ON_SURFACE, LINE, MUTED, SUNKEN, SURFACE, TEXT } from '../../ui/theme';

/**
 * The graph's interface, on one page, built on the page itself.
 *
 * The blocks of every gui node in graph order; edits go back to whichever node
 * owns the block. One graph, one tool, one page -- a bundle's recipient wants a
 * window, not three.
 */
export default function DesignerTab() {
  const updateNode = useGraphStore((s) => s.updateNode);
  const addNode = useGraphStore((s) => s.addNode);
  const guiScheme = useGraphStore((s) => s.metadata.gui_scheme);
  const setMetadata = useGraphStore((s) => s.setMetadata);
  const blocks = useSurfaceBlocks();
  const guiNodes = useGuiNodes();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Typing in a live widget while designing: kept local until the next run, so
  // the graph is not marked unsaved on every keystroke.
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const ownerOf = (widgetId: string) => blocks.find((b) => b.widget.id === widgetId)?.node ?? null;
  const selected = blocks.find((b) => b.widget.id === selectedId)?.widget ?? null;

  /**
   * Write a new page back to the nodes it came from.
   *
   * A block keeps its owner: reordering rearranges the page, it does not move a
   * widget between nodes. Moving one would silently move a port to a different
   * node and take its edges with it -- more than a drag should ever mean.
   */
  const applyWidgets = (next: GuiWidget[]) => {
    const nodes = [...new Set(blocks.map((b) => b.node))];
    const byNode = new Map<string, GuiWidget[]>();
    for (const widget of next) {
      const owner = ownerOf(widget.id) ?? nodes[0];
      if (!owner) continue;
      byNode.set(owner.id, [...(byNode.get(owner.id) ?? []), widget]);
    }
    for (const node of nodes) {
      const widgets = byNode.get(node.id) ?? [];
      if (JSON.stringify(widgets) === JSON.stringify(node.config.gui_widgets)) continue;
      updateNode(node.id, syncGuiNodePorts({ ...node, config: { ...node.config, gui_widgets: widgets } }));
    }
  };

  /**
   * Add a block to the page, at the end -- the order is the position.
   *
   * With no gui node in the graph yet, one is created to hold it. The page is
   * the thing being built; that it needs a node behind it is bookkeeping, and
   * making someone go to the other tab to satisfy the bookkeeping first is the
   * kind of step a tool should take on itself.
   */
  const addWidget = (kind: GuiWidgetKind, mode?: string, at?: number) => {
    const widget = createGuiWidget(kind, '', mode);
    const target = blocks[blocks.length - 1]?.node ?? guiNodes[0];
    if (target) {
      const next = blocks.map((b) => b.widget);
      next.splice(at ?? next.length, 0, widget);
      applyWidgets(next);
    } else {
      const nodeId = addNode('gui', { x: 240, y: 160 });
      const created = useGraphStore.getState().rfNodes
        .find((n) => n.id === nodeId)?.data.graphNode as GraphNode | undefined;
      if (!created) return;
      updateNode(nodeId, syncGuiNodePorts({
        ...created,
        config: { ...created.config, gui_widgets: [widget] },
      }));
    }
    setSelectedId(widget.id);
  };

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
      if (index !== null) addWidget(dragEntry.kind, dragEntry.mode, index);
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
    const to = selectedIndex + delta;
    if (selectedIndex === -1 || to < 0 || to >= blocks.length) return;
    const next = blocks.map((b) => b.widget);
    const [moved] = next.splice(selectedIndex, 1);
    next.splice(to, 0, moved);
    applyWidgets(next);
  };

  const removeSelected = () => {
    if (!selected) return;
    applyWidgets(blocks.filter((b) => b.widget.id !== selected.id).map((b) => b.widget));
    setSelectedId(null);
  };

  // Delete removes the selected block, Ctrl+Arrow reorders it. Ignored while a
  // field has focus -- the blocks are live, so typing in a text block would
  // otherwise delete it mid-sentence.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!selectedId) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
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

  const updateSelected = (patch: Partial<GuiWidget>) => {
    if (!selected) return;
    applyWidgets(blocks.map((b) => (b.widget.id === selected.id ? { ...b.widget, ...patch } : b.widget)));
  };

  /** A live edit in a widget: remembered locally, and stored on its own node. */
  const setWidgetValue = (block: SurfaceBlock, value: string) => {
    setOverrides((prev) => ({ ...prev, [block.widget.id]: value }));
    updateNode(block.node.id, {
      config: {
        ...block.node.config,
        gui_widgets: block.node.config.gui_widgets.map(
          (w) => (w.id === block.widget.id ? { ...w, value } : w),
        ),
      },
    });
  };

  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: SUNKEN }}>
      <DesignerPalette onAdd={addWidget} onDragStart={(entry) => setDragEntry(entry)} />

      <div
        data-gui-dropzone
        className="flex-1 overflow-auto px-8 py-6"
        style={dragEntry ? { outline: `2px dashed ${ACCENT}`, outlineOffset: -6 } : undefined}
      >
        <GuiDesigner
          dropIndex={dragEntry ? dropIndex : null}
          blocks={blocks}
          onChange={applyWidgets}
          onWidgetValue={setWidgetValue}
          selectedId={selectedId}
          onSelect={setSelectedId}
          overrides={overrides}
        />
      </div>

      <aside
        className="overflow-y-auto px-3 py-4"
        style={{ width: 340, background: SURFACE, borderLeft: `1px solid ${LINE}`, flexShrink: 0 }}
      >
        {/* One choice for the whole page, from a closed set -- `tone` says what a
            block is, this says what the tool looks like. Every accent is picked
            to sit on the same surfaces, so no combination can come out wrong. */}
        <label className="block text-xs font-medium uppercase tracking-wider mb-2" style={{ color: MUTED }}>
          Farbschema der Seite
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
          Eigenschaften
        </h3>
        <GuiWidgetProperties
          widget={selected}
          onChange={updateSelected}
          onRemove={removeSelected}
        />
        {selected && new Set(blocks.map((b) => b.node.id)).size > 1 && (
          <p className="text-xs mt-3" style={{ color: DIMMER }}>
            Gehört zu „{ownerOf(selected.id)?.label}".
          </p>
        )}
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

/** The same page, read-only chrome: what a deployed tool shows. */
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
      <GuiSurface blocks={blocks} onWidgetValue={setWidgetValue} />
    </div>
  );
}
