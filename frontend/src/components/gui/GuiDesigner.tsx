import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GuiWidget, GuiWidgetKind } from '../../types/graph';
import { createGuiWidget, CREATABLE_GUI_WIDGET_KINDS, GUI_WIDGET_KIND_LABELS } from '../../utils/guiWidgets';
import { GUI_GRID_COLUMNS, GUI_GRID_ROW_HEIGHT, resolveWidgetLayout, layoutRowCount } from './layout';
import {
  ACCENT, ACCENT_TEXT, DANGER, DIMMER, FIELD, FIELD_ON_SURFACE, LINE, MUTED,
  NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT,
} from '../../ui/theme';

interface GuiDesignerProps {
  widgets: GuiWidget[];
  onChange: (widgets: GuiWidget[]) => void;
  columns?: number;
  onGridChange?: (patch: { columns?: number }) => void;
  selectedId: string | null;
  onSelect: (widgetId: string | null) => void;
}

const CELL_WIDTH = 46;

interface DragState {
  widgetId: string;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  origin: { x: number; y: number; w: number; h: number };
}

/**
 * The gui node's editor: widgets are added, arranged, selected and removed on
 * one grid. Drag to move, drag the corner to resize, or type exact cells.
 *
 * This used to be one of two views behind a `widgets | designer` tab switch,
 * with the same widget list also editable as an ordered list. That meant a gui
 * node had two-and-a-half ways to say where a widget goes -- a small/medium/
 * large preset, the list's order (the layout for anything never placed), and
 * x/y/w/h -- so the same widget could be described three times and disagree.
 * The canvas is now the only answer: order carries no meaning, `size` is gone,
 * and what a selected widget *is* lives beside it rather than in a second tab.
 *
 * Layout writes only the presentational x/y/w/h fields. Ports are derived from
 * the widget list, so nothing here can detach an edge.
 */
export default function GuiDesigner({
  widgets, onChange, columns = GUI_GRID_COLUMNS, onGridChange, selectedId, onSelect,
}: GuiDesignerProps) {
  const drag = useRef<DragState | null>(null);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  const [newWidgetKind, setNewWidgetKind] = useState<GuiWidgetKind>('text_io');

  const placements = resolveWidgetLayout(widgets, columns);
  const placementById = new Map(placements.map((p) => [p.widget.id, p]));
  // Tight fit, matching the runtime GuiWindow exactly -- no padding row or
  // artificial floor, so the editor never shows background beyond what the
  // placed widgets actually occupy.
  const rows = layoutRowCount(placements);
  const contentColumns = Math.max(1, ...placements.map((p) => p.x + p.w));
  const selected = placementById.get(selectedId ?? '');

  const patchWidget = useCallback(
    (widgetId: string, patch: Partial<GuiWidget>) => {
      onChange(widgetsRef.current.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)));
    },
    [onChange]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const state = drag.current;
      if (!state) return;
      const dx = Math.round((e.clientX - state.startClientX) / CELL_WIDTH);
      const dy = Math.round((e.clientY - state.startClientY) / GUI_GRID_ROW_HEIGHT);

      if (state.mode === 'move') {
        const w = state.origin.w;
        patchWidget(state.widgetId, {
          x: Math.min(columns - w, Math.max(0, state.origin.x + dx)),
          y: Math.max(0, state.origin.y + dy),
          w,
          h: state.origin.h,
        });
      } else {
        patchWidget(state.widgetId, {
          x: state.origin.x,
          y: state.origin.y,
          w: Math.min(columns - state.origin.x, Math.max(1, state.origin.w + dx)),
          h: Math.max(1, state.origin.h + dy),
        });
      }
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [patchWidget, columns]);

  const startDrag = (e: React.MouseEvent, widgetId: string, mode: DragState['mode']) => {
    const placement = placementById.get(widgetId);
    if (!placement) return;
    e.preventDefault();
    e.stopPropagation();
    // Selecting on mousedown rather than click: a drag is also how you pick the
    // widget you are about to edit, and requiring a separate click for that is
    // the kind of friction nobody reports but everybody feels.
    onSelect(widgetId);
    drag.current = {
      widgetId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: { x: placement.x, y: placement.y, w: placement.w, h: placement.h },
    };
  };

  const addWidget = () => {
    const widget = createGuiWidget(newWidgetKind);
    onChange([...widgets, widget]);
    onSelect(widget.id);
  };

  const removeSelected = () => {
    if (!selected) return;
    const name = selected.widget.label || selected.widget.id;
    // Removing a widget removes its ports, and saving the node then prunes every
    // edge attached to them -- elsewhere in the graph, out of sight. Say so
    // rather than letting wires vanish silently.
    if (!window.confirm(`Remove "${name}"? Any connections to its ports will be dropped when you save this node.`)) return;
    onChange(widgets.filter((w) => w.id !== selected.widget.id));
    onSelect(null);
  };

  const autoArrange = () => {
    onChange(widgets.map((w) => ({ ...w, x: undefined, y: undefined })));
  };

  return (
    <div>
      <div className="flex items-end gap-2 mb-3">
        <div className="flex-1">
          <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Add widget</label>
          <select
            className="w-full rounded-lg px-2 py-1.5 text-sm"
            style={FIELD_ON_SURFACE}
            value={newWidgetKind}
            onChange={(e) => setNewWidgetKind(e.target.value as GuiWidgetKind)}
          >
            {CREATABLE_GUI_WIDGET_KINDS.map((k) => (
              <option key={k} value={k}>{GUI_WIDGET_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={addWidget}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={PRIMARY_BUTTON}
          aria-label="Add widget"
        >
          + Add
        </button>
        <button
          onClick={removeSelected}
          disabled={!selected}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: DANGER, color: 'white', opacity: selected ? 1 : 0.4 }}
          title={selected ? 'Remove the selected widget' : 'Select a widget first'}
          aria-label="Remove selected widget"
        >
          Remove
        </button>
      </div>

      {widgets.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: DIMMER }}>
          No widgets yet — add one above. Ports are generated from the widgets automatically.
        </p>
      ) : (
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs" style={{ color: DIMMER }}>
            Click to select, drag to move, drag the corner to resize. Layout is presentational only — ports never change.
          </p>
          <button
            onClick={() => {
              const placed = widgets.filter((w) => w.x !== undefined || w.y !== undefined).length;
              // Only ask when there is actually a layout to destroy; there is no
              // undo, and the button sits right next to the grid it flattens.
              if (placed > 0 && !window.confirm(
                `Clear the positions of ${placed} placed widget${placed === 1 ? '' : 's'} and stack them top to bottom?`,
              )) return;
              autoArrange();
            }}
            className="text-xs px-2 py-1 rounded flex-shrink-0"
            style={NEUTRAL_BUTTON}
            title="Clear positions and stack widgets top to bottom"
          >
            Auto-arrange
          </button>
        </div>
      )}

      {onGridChange && widgets.length > 0 && (
        <div className="flex items-center gap-4 mb-2">
          <label className="flex items-center gap-1 text-xs" style={{ color: MUTED }}>
            Background columns
            <input
              type="number"
              min={1}
              max={48}
              className="w-14 rounded px-1 py-0.5 text-xs"
              style={FIELD}
              value={columns}
              onChange={(e) => onGridChange({ columns: Math.max(1, Math.min(48, Number(e.target.value) || columns)) })}
            />
          </label>
          <button
            onClick={() => onGridChange({ columns: contentColumns })}
            disabled={contentColumns === columns}
            className="text-xs px-2 py-1 rounded"
            style={{ ...NEUTRAL_BUTTON, opacity: contentColumns === columns ? 0.4 : 1 }}
            title="Shrink background columns to exactly wrap the placed widgets"
          >
            Fit width to content
          </button>
        </div>
      )}

      {widgets.length > 0 && (
        <div
          className="relative rounded-lg overflow-auto"
          style={{
            background: SUNKEN,
            border: `1px solid ${LINE}`,
            width: columns * CELL_WIDTH,
            height: rows * GUI_GRID_ROW_HEIGHT,
            maxWidth: '100%',
            backgroundImage:
              'linear-gradient(to right, #1c2036 1px, transparent 1px), linear-gradient(to bottom, #1c2036 1px, transparent 1px)',
            backgroundSize: `${CELL_WIDTH}px ${GUI_GRID_ROW_HEIGHT}px`,
          }}
          onMouseDown={() => onSelect(null)}
        >
          {placements.map(({ widget, x, y, w, h }) => {
            const isSelected = widget.id === selectedId;
            return (
              <div
                key={widget.id}
                className="absolute rounded-lg px-2 py-1 overflow-hidden cursor-move select-none"
                style={{
                  left: x * CELL_WIDTH + 2,
                  top: y * GUI_GRID_ROW_HEIGHT + 2,
                  width: w * CELL_WIDTH - 4,
                  height: h * GUI_GRID_ROW_HEIGHT - 4,
                  background: isSelected ? '#3b2569' : '#2d1b4e',
                  border: `${isSelected ? 2 : 1}px solid ${isSelected ? ACCENT_TEXT : ACCENT}`,
                }}
                onMouseDown={(e) => startDrag(e, widget.id, 'move')}
              >
                <div className="text-xs font-medium truncate" style={{ color: TEXT }}>
                  {widget.label || widget.id}
                </div>
                <div className="text-xs truncate" style={{ color: ACCENT_TEXT }}>
                  {GUI_WIDGET_KIND_LABELS[widget.kind]}
                </div>
                <div
                  className="absolute"
                  style={{ right: 0, bottom: 0, width: 12, height: 12, background: ACCENT, cursor: 'nwse-resize' }}
                  onMouseDown={(e) => startDrag(e, widget.id, 'resize')}
                  title="Resize"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Exact cells, for the selected widget only. Showing a row per widget was
          a second full list of everything -- the thing this view exists to
          replace -- and the numbers only matter for whatever you are placing. */}
      {selected && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs truncate flex-1 min-w-0" style={{ color: MUTED }}>
            {selected.widget.label || selected.widget.id}
          </span>
          {([
            ['x', selected.x, 0, columns - 1],
            ['y', selected.y, 0, 999],
            ['w', selected.w, 1, columns],
            ['h', selected.h, 1, 999],
          ] as const).map(([field, value, min, max]) => (
            <label key={field} className="flex items-center gap-1 text-xs" style={{ color: DIMMER }}>
              {field}
              <input
                type="number"
                min={min}
                max={max}
                className="w-12 rounded px-1 py-0.5 text-xs"
                style={FIELD}
                value={value}
                onChange={(e) => {
                  const next = Math.max(min, Math.min(max, Number(e.target.value) || 0));
                  patchWidget(selected.widget.id, {
                    x: selected.x, y: selected.y, w: selected.w, h: selected.h, [field]: next,
                  });
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
