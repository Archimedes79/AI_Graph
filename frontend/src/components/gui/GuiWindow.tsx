import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphNode, GuiWidget } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { GUI_GRID_COLUMNS, GUI_GRID_ROW_HEIGHT, layoutRowCount, resolveWidgetLayout } from './layout';
import { GUI_WIDGET_ELEMENTS } from '../../elements/registry';
import { valueToText } from './widgetProps';
import { DANGER, DIMMER, LINE, MUTED, SUNKEN, SURFACE, TEXT } from '../../ui/theme';

interface GuiWindowProps {
  node: GraphNode;
  index: number;
  onClose: () => void;
}

const windowChrome = { background: SURFACE, border: `1px solid ${LINE}` } as const;
const headerChrome = { background: SUNKEN, borderBottom: `1px solid ${LINE}` } as const;

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
  const prevResultRef = useRef(nodeResult);
  useEffect(() => {
    setOverrides({});
    // A new run completed while this window was open (not just the initial
    // mount) -- clear any one-shot widget values (e.g. a sent chat message)
    // so they aren't resent on the next run. See `clearValueAfterRun`.
    if (prevResultRef.current !== undefined && prevResultRef.current !== nodeResult) {
      const toClear = node.config.gui_widgets.filter(
        (w) => GUI_WIDGET_ELEMENTS[w.kind].clearValueAfterRun?.(w) && w.value
      );
      if (toClear.length > 0) {
        updateNode(node.id, {
          config: {
            ...node.config,
            gui_widgets: node.config.gui_widgets.map((w) => (toClear.includes(w) ? { ...w, value: '' } : w)),
          },
        });
      }
    }
    prevResultRef.current = nodeResult;
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

  const placements = resolveWidgetLayout(node.config.gui_widgets, node.config.gui_grid_columns ?? GUI_GRID_COLUMNS);
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
        <span className="text-sm font-semibold flex items-center gap-2" style={{ color: TEXT }}>
          🖥️ {node.label}
        </span>
        <button
          onClick={onClose}
          style={{ color: MUTED }}
          className="hover:text-white text-sm"
          aria-label={`Close ${node.label} window`}
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {node.config.gui_widgets.length === 0 ? (
          <p className="text-xs" style={{ color: DIMMER }}>
            This GUI node has no widgets yet — add some in the node editor.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(${node.config.gui_grid_columns ?? GUI_GRID_COLUMNS}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, minmax(${GUI_GRID_ROW_HEIGHT}px, auto))`,
            }}
          >
            {placements.map(({ widget, x, y, w, h }) => {
              const WidgetComponent = GUI_WIDGET_ELEMENTS[widget.kind].RuntimeWidget;
              const incoming = nodeResult?.inputs?.[`${widget.id}_in`];
              const outgoing = nodeResult?.outputs?.[`${widget.id}_out`];
              // What the widget itself holds: the edit in flight, else its
              // stored value. Kept apart from `incoming` so a widget that both
              // shows and accepts text (a chat window) does not overwrite the
              // reply the user is reading as they type.
              const ownValue = overrides[widget.id] ?? widget.value ?? '';
              const value = incoming !== undefined && overrides[widget.id] === undefined ? incoming : ownValue;

              return (
                <div
                  key={widget.id}
                  className="rounded-lg px-3 py-2 flex flex-col gap-1 min-w-0"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${LINE}`,
                    gridColumn: `${x + 1} / span ${w}`,
                    gridRow: `${y + 1} / span ${h}`,
                  }}
                >
                  <span className="text-xs font-medium flex-shrink-0" style={{ color: MUTED }}>
                    {widget.label || widget.id}
                  </span>
                  <div className="flex-1 min-h-0">
                    {WidgetComponent ? (
                      <WidgetComponent
                        widget={widget}
                        value={value}
                        incoming={incoming}
                        onChange={(next) => setWidgetValue(widget, next)}
                      />
                    ) : (
                      <span className="text-xs" style={{ color: DANGER }}>
                        Unsupported widget kind: {widget.kind}
                      </span>
                    )}
                  </div>
                  {outgoing !== undefined && (
                    <span className="text-xs truncate flex-shrink-0" style={{ color: DIMMER }} title={valueToText(outgoing)}>
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
