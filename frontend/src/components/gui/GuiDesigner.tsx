import React, { useCallback, useEffect, useRef } from 'react';
import type { GuiWidget } from '../../types/graph';
import { GUI_WIDGET_KIND_LABELS } from '../../utils/guiWidgets';
import { GUI_GRID_COLUMNS, GUI_GRID_ROW_HEIGHT, resolveWidgetLayout, layoutRowCount } from './layout';

interface GuiDesignerProps {
  widgets: GuiWidget[];
  onChange: (widgets: GuiWidget[]) => void;
  columns?: number;
  onGridChange?: (patch: { columns?: number }) => void;
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
 * Grid designer for a gui node's widgets: drag to move, drag the corner to
 * resize, or type exact cells. Writes only the presentational `x/y/w/h` fields.
 */
export default function GuiDesigner({ widgets, onChange, columns = GUI_GRID_COLUMNS, onGridChange }: GuiDesignerProps) {
  const drag = useRef<DragState | null>(null);
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;

  const placements = resolveWidgetLayout(widgets, columns);
  const placementById = new Map(placements.map((p) => [p.widget.id, p]));
  // Tight fit, matching the runtime GuiWindow exactly -- no padding row or
  // artificial floor, so the editor never shows background beyond what the
  // placed widgets actually occupy.
  const rows = layoutRowCount(placements);
  const contentColumns = Math.max(1, ...placements.map((p) => p.x + p.w));

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
    drag.current = {
      widgetId,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origin: { x: placement.x, y: placement.y, w: placement.w, h: placement.h },
    };
  };

  const autoArrange = () => {
    onChange(widgets.map((w) => ({ ...w, x: undefined, y: undefined })));
  };

  if (widgets.length === 0) {
    return (
      <p className="text-xs" style={{ color: '#475569' }}>
        No widgets yet — add some in the Config tab first.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs" style={{ color: '#475569' }}>
          Drag to move, drag the corner to resize. Layout is presentational only — ports never change.
        </p>
        <button
          onClick={autoArrange}
          className="text-xs px-2 py-1 rounded flex-shrink-0"
          style={{ background: '#2d3148', color: '#e2e8f0' }}
          title="Clear positions and stack widgets in list order"
        >
          Auto-arrange
        </button>
      </div>

      {onGridChange && (
        <div className="flex items-center gap-4 mb-2">
          <label className="flex items-center gap-1 text-xs" style={{ color: '#94a3b8' }}>
            Background columns
            <input
              type="number"
              min={1}
              max={48}
              className="w-14 rounded px-1 py-0.5 text-xs"
              style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
              value={columns}
              onChange={(e) => onGridChange({ columns: Math.max(1, Math.min(48, Number(e.target.value) || columns)) })}
            />
          </label>
          <button
            onClick={() => onGridChange({ columns: contentColumns })}
            disabled={contentColumns === columns}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#2d3148', color: '#e2e8f0', opacity: contentColumns === columns ? 0.4 : 1 }}
            title="Shrink background columns to exactly wrap the placed widgets"
          >
            Fit width to content
          </button>
        </div>
      )}

      <div
        className="relative rounded-lg overflow-auto"
        style={{
          background: '#0f1117',
          border: '1px solid #2d3148',
          width: columns * CELL_WIDTH,
          height: rows * GUI_GRID_ROW_HEIGHT,
          maxWidth: '100%',
          backgroundImage:
            'linear-gradient(to right, #1c2036 1px, transparent 1px), linear-gradient(to bottom, #1c2036 1px, transparent 1px)',
          backgroundSize: `${CELL_WIDTH}px ${GUI_GRID_ROW_HEIGHT}px`,
        }}
      >
        {placements.map(({ widget, x, y, w, h }) => (
          <div
            key={widget.id}
            className="absolute rounded-lg px-2 py-1 overflow-hidden cursor-move select-none"
            style={{
              left: x * CELL_WIDTH + 2,
              top: y * GUI_GRID_ROW_HEIGHT + 2,
              width: w * CELL_WIDTH - 4,
              height: h * GUI_GRID_ROW_HEIGHT - 4,
              background: '#2d1b4e',
              border: '1px solid #6366f1',
            }}
            onMouseDown={(e) => startDrag(e, widget.id, 'move')}
          >
            <div className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }}>
              {widget.label || widget.id}
            </div>
            <div className="text-xs truncate" style={{ color: '#a5b4fc' }}>
              {GUI_WIDGET_KIND_LABELS[widget.kind]}
            </div>
            <div
              className="absolute"
              style={{ right: 0, bottom: 0, width: 12, height: 12, background: '#6366f1', cursor: 'nwse-resize' }}
              onMouseDown={(e) => startDrag(e, widget.id, 'resize')}
              title="Resize"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {placements.map(({ widget, x, y, w, h }) => (
          <div key={widget.id} className="flex items-center gap-2">
            <span className="text-xs truncate flex-1 min-w-0" style={{ color: '#94a3b8' }}>
              {widget.label || widget.id}
            </span>
            {([
              ['x', x, 0, columns - 1],
              ['y', y, 0, 999],
              ['w', w, 1, columns],
              ['h', h, 1, 999],
            ] as const).map(([field, value, min, max]) => (
              <label key={field} className="flex items-center gap-1 text-xs" style={{ color: '#475569' }}>
                {field}
                <input
                  type="number"
                  min={min}
                  max={max}
                  className="w-12 rounded px-1 py-0.5 text-xs"
                  style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                  value={value}
                  onChange={(e) => {
                    const next = Math.max(min, Math.min(max, Number(e.target.value) || 0));
                    patchWidget(widget.id, { x, y, w, h, [field]: next });
                  }}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
