import React, { useCallback, useEffect, useRef } from 'react';
import type { GuiWidget } from '../../types/graph';
import { GUI_WIDGET_KIND_LABELS } from '../../utils/guiWidgets';
import GuiSurface, { type SurfaceBlock } from './GuiSurface';
import { useContainerCell } from './useContainerCell';
import { GUI_GRID_COLUMNS } from './layout';
import { DANGER, DIMMER } from '../../ui/theme';

interface GuiDesignerProps {
  blocks: SurfaceBlock[];
  /** The whole page, rewritten. The caller routes each block back to its node. */
  onChange: (widgets: GuiWidget[]) => void;
  onWidgetValue: (block: SurfaceBlock, value: string) => void;
  selectedId: string | null;
  onSelect: (widgetId: string | null) => void;
  overrides?: Record<string, string>;
  /** Where a palette drag in flight would land, drawn as an insertion line. */
  dropIndex?: number | null;
}

/**
 * The page, plus the few affordances needed to build one.
 *
 * Everything visual lives in `GuiSurface`, which the deployed tool renders too
 * -- so this adds a palette, a selection, a drag handle and a resize corner,
 * and nothing else. The widgets stay **live** while you design: you can type in
 * a field and press ▶ and watch the same blocks fill, because designing and
 * using are the same page.
 */
export default function GuiDesigner({
  blocks, onChange, onWidgetValue, selectedId, onSelect, overrides, dropIndex,
}: GuiDesignerProps) {
  const { cell } = useContainerCell();
  const widgets = blocks.map((b) => b.widget);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const selected = widgets.find((w) => w.id === selectedId) ?? null;

  const patchWidget = useCallback((widgetId: string, patch: Partial<GuiWidget>) => {
    onChange(widgetsRef.current.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)));
  }, [onChange]);

  // ---- resize: the one thing the grid is still dragged for -------------------
  const resize = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = resize.current;
      if (!state) return;
      patchWidget(state.id, {
        w: Math.max(1, Math.min(GUI_GRID_COLUMNS, state.w + Math.round((e.clientX - state.x) / cell))),
        h: Math.max(1, state.h + Math.round((e.clientY - state.y) / cell)),
      });
    };
    const onUp = () => { resize.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [patchWidget, cell]);

  const reorder = (fromId: string, toId: string) => {
    const from = widgetsRef.current.findIndex((w) => w.id === fromId);
    const to = widgetsRef.current.findIndex((w) => w.id === toId);
    if (from === -1 || to === -1 || from === to) return;
    const next = [...widgetsRef.current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3" style={{ minHeight: 26 }}>
        <p className="text-xs" style={{ color: DIMMER }}>
          {widgets.length === 0
            ? 'Noch nichts auf der Seite — links ein Element wählen. Die Ports entstehen automatisch daraus.'
            : 'Die Felder sind bedienbar: tippen, auswählen, dann ▶ Run.'}
        </p>
      </div>

      <GuiSurface
        blocks={blocks}
        onWidgetValue={onWidgetValue}
        editing
        selectedId={selectedId}
        onSelect={onSelect}
        onReorder={reorder}
        onResizeStart={(id, e, w, h) => { resize.current = { id, x: e.clientX, y: e.clientY, w, h }; }}
        overrides={overrides}
        dropIndex={dropIndex}
      />
    </div>
  );
}
