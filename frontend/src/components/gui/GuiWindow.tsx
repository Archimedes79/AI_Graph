import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphNode, GuiWidget } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { GUI_GRID_COLUMNS, GUI_GRID_ROW_HEIGHT, layoutRowCount, resolveWidgetLayout } from './layout';
import { GUI_WIDGET_RUNTIME_COMPONENTS } from './widgets';
import { valueToText } from './widgetProps';

interface GuiWindowProps {
  node: GraphNode;
  index: number;
  onClose: () => void;
}

const windowChrome = { background: '#1a1d2e', border: '1px solid #2d3148' } as const;
const headerChrome = { background: '#0f1117', borderBottom: '1px solid #2d3148' } as const;

/**
 * The runtime window of a single `gui` node: every one of its widgets, laid
 * out together on the designer's 12-column grid, fed with the values from the
 * last run and writing edits straight back into the graph.
 */
export default function GuiWindow({ node, index, onClose }: GuiWindowProps) {
  const nodeResult = useGraphStore((s) => s.executionResult?.node_results.find((r) => r.node_id === node.id));
  const updateNode = useGraphStore((s) => s.updateNode);

  const [position, setPosition] = useState({ x: 80 + index * 28, y: 96 + index * 28 });
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  // Local edits win over the last run's inputs until the next run replaces them.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    setOverrides({});
  }, [nodeResult]);

  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragOffset.current = { x: e.clientX - position.x, y: e.clientY - position.y };
      e.preventDefault();
    },
    [position.x, position.y]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragOffset.current) return;
      setPosition({
        x: Math.max(0, e.clientX - dragOffset.current.x),
        y: Math.max(0, e.clientY - dragOffset.current.y),
      });
    };
    const onUp = () => {
      dragOffset.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const setWidgetValue = (widget: GuiWidget, value: string) => {
    setOverrides((prev) => ({ ...prev, [widget.id]: value }));
    updateNode(node.id, {
      config: {
        ...node.config,
        gui_widgets: node.config.gui_widgets.map((w) => (w.id === widget.id ? { ...w, value } : w)),
      },
    });
  };

  const placements = resolveWidgetLayout(node.config.gui_widgets);
  const rows = layoutRowCount(placements);

  return (
    <div
      className="fixed z-40 rounded-xl shadow-2xl flex flex-col"
      style={{
        ...windowChrome,
        left: position.x,
        top: position.y,
        width: 560,
        maxWidth: '90vw',
        maxHeight: '80vh',
        resize: 'both',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0 cursor-move"
        style={headerChrome}
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: '#e2e8f0' }}>
          🖥️ {node.label}
        </span>
        <button onClick={onClose} style={{ color: '#94a3b8' }} className="hover:text-white text-sm">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {node.config.gui_widgets.length === 0 ? (
          <p className="text-xs" style={{ color: '#475569' }}>
            This GUI node has no widgets yet — add some in the node editor.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${GUI_GRID_COLUMNS}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, minmax(${GUI_GRID_ROW_HEIGHT}px, auto))`,
            }}
          >
            {placements.map(({ widget, x, y, w, h }) => {
              const WidgetComponent = GUI_WIDGET_RUNTIME_COMPONENTS[widget.kind];
              const incoming = nodeResult?.inputs?.[`${widget.id}_in`];
              const outgoing = nodeResult?.outputs?.[`${widget.id}_out`];
              const value = overrides[widget.id] ?? (incoming !== undefined ? incoming : widget.value ?? '');

              return (
                <div
                  key={widget.id}
                  className="rounded-lg px-3 py-2 flex flex-col gap-1 min-w-0"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid #2d3148',
                    gridColumn: `${x + 1} / span ${w}`,
                    gridRow: `${y + 1} / span ${h}`,
                  }}
                >
                  <span className="text-xs font-medium flex-shrink-0" style={{ color: '#94a3b8' }}>
                    {widget.label || widget.id}
                  </span>
                  <div className="flex-1 min-h-0">
                    {WidgetComponent ? (
                      <WidgetComponent
                        widget={widget}
                        value={value}
                        onChange={(next) => setWidgetValue(widget, next)}
                      />
                    ) : (
                      <span className="text-xs" style={{ color: '#ef4444' }}>
                        Unsupported widget kind: {widget.kind}
                      </span>
                    )}
                  </div>
                  {outgoing !== undefined && (
                    <span className="text-xs truncate flex-shrink-0" style={{ color: '#475569' }} title={valueToText(outgoing)}>
                      → {valueToText(outgoing).slice(0, 80)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
