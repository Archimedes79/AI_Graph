import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import type { RFNodeData } from '../../types/graph';
import { NODE_TYPE_COLORS, NODE_TYPE_ICON, NODE_TYPE_LABELS } from '../../utils/nodeDefaults';
import { useGraphStore } from '../../store/graphStore';
import PlotWidget from '../PlotWidget';
import { ACCENT, DANGER, DANGER_TEXT, DIMMER, LINE, MUTED, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '../../ui/theme';

// Colour AND a glyph: a red/green 8px dot is unreadable both to a screen
// reader and to a colour-blind user scanning a canvas for the failed node.
const statusStyles: Record<string, { color: string; glyph: string }> = {
  success: { color: SUCCESS, glyph: '✓' },
  error: { color: DANGER, glyph: '!' },
  running: { color: '#f59e0b', glyph: '…' },
  pending: { color: '#6b7280', glyph: '·' },
};

function dataValuePreview(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const GraphNodeComponent = memo(({ id, data, selected }: NodeProps<RFNodeData>) => {
  const { graphNode, onEdit, onDelete } = data;
  const executionResult = useGraphStore((s) =>
    s.executionResult?.node_results.find((r) => r.node_id === id)
  );

  const bgColor = NODE_TYPE_COLORS[graphNode.node_type] ?? SURFACE;
  const icon = NODE_TYPE_ICON[graphNode.node_type] ?? '⬜';
  const status = executionResult ? statusStyles[executionResult.status] : undefined;
  const statusColor = status?.color;
  const isGuiLike = graphNode.node_type === 'gui' || graphNode.node_type === 'widget';

  const handleEdit = useCallback(() => onEdit(id), [id, onEdit]);
  // The ✕ sits a few pixels from ✏️, deleting is immediate, it silently takes
  // every attached edge with it, and there is no undo -- so a node that is
  // wired into the graph asks first. An unconnected node deletes straight away,
  // because that is the case where a confirmation is just noise.
  const connectedEdgeCount = useGraphStore(
    (s) => s.rfEdges.filter((edge) => edge.source === id || edge.target === id).length
  );
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (connectedEdgeCount > 0) {
        const wires = `${connectedEdgeCount} connection${connectedEdgeCount === 1 ? '' : 's'}`;
        if (!window.confirm(`Delete "${graphNode.label}"? Its ${wires} will be removed too.`)) return;
      }
      onDelete(id);
    },
    [connectedEdgeCount, graphNode.label, id, onDelete]
  );

  return (
    <div
      className="rounded-lg overflow-hidden shadow-lg select-none"
      style={
        isGuiLike
          ? { background: bgColor, border: `2px solid ${statusColor ?? LINE}`, width: '100%', height: '100%' }
          : { background: bgColor, border: `2px solid ${statusColor ?? LINE}`, minWidth: 180, maxWidth: 240 }
      }
    >
      {isGuiLike && (
        <NodeResizer
          isVisible={selected}
          minWidth={220}
          minHeight={140}
          lineStyle={{ borderColor: ACCENT }}
          handleStyle={{ background: ACCENT, width: 8, height: 8 }}
        />
      )}
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer"
        style={{ background: 'rgba(0,0,0,0.3)' }}
        onDoubleClick={handleEdit}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="text-base leading-none">{icon}</span>
          <span
            className="text-sm font-semibold truncate"
            style={{ color: TEXT }}
          >
            {graphNode.label}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {status && (
            <span
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold leading-none"
              style={{ background: status.color, color: SUNKEN }}
              role="img"
              aria-label={`Last run: ${executionResult?.status}`}
              title={executionResult?.status}
            >
              {status.glyph}
            </span>
          )}
          <button
            onClick={handleEdit}
            className="text-xs px-1.5 py-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
            style={PRIMARY_BUTTON}
            title="Edit node"
            aria-label={`Edit node ${graphNode.label}`}
          >
            ✏️
          </button>
          <button
            onClick={handleDelete}
            className="text-xs px-1.5 py-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
            style={{ background: DANGER, color: 'white' }}
            title="Delete node"
            aria-label={`Delete node ${graphNode.label}`}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Ports — GUI/widget nodes get a special two-column layout: outputs left, inputs right */}
      {isGuiLike ? (
        <div className="px-3 py-2">
          <div className="grid grid-cols-2 gap-x-2">
            {/* Left column: source (output) ports — handles on the left edge */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold mb-0.5" style={{ color: DIMMER }}>→ OUT</span>
              {graphNode.outputs.map((port) => (
                <div key={port.id} className="relative flex items-center gap-1.5" style={{ marginLeft: -12 }}>
                  <Handle
                    type="source"
                    position={Position.Left}
                    id={port.id}
                    style={{
                      background: port.multi ? '#a78bfa' : SUCCESS,
                      border: '2px solid #14532d',
                      width: 10, height: 10,
                      position: 'relative', transform: 'none', top: 'auto', left: 'auto',
                      flexShrink: 0,
                    }}
                    title={port.description || port.name}
                    onClick={(e) => { e.stopPropagation(); data.onPortEdit(id, port.id); }}
                  />
                  <span className="text-xs truncate" style={{ color: '#86efac' }}>
                    {port.name}{port.multi && <span title="Multi"> ∞</span>}
                  </span>
                </div>
              ))}
            </div>
            {/* Right column: target (input) ports — handles on the right edge */}
            <div className="flex flex-col gap-1 items-end">
              <span className="text-xs font-semibold mb-0.5" style={{ color: DIMMER }}>IN ←</span>
              {graphNode.inputs.map((port) => {
                const plotWidget = graphNode.config.gui_widgets.find(
                  (w) => w.kind === 'plot_window' && `${w.id}_in` === port.id
                );
                return (
                  <React.Fragment key={port.id}>
                    <div className="relative flex items-center gap-1.5" style={{ marginRight: -12 }}>
                      <span className="text-xs truncate" style={{ color: MUTED }}>
                        {port.name}{port.multi && <span title="Multi"> ∞</span>}
                      </span>
                      <Handle
                        type="target"
                        position={Position.Right}
                        id={port.id}
                        style={{
                          background: port.multi ? '#a78bfa' : ACCENT,
                          border: '2px solid #312e81',
                          width: 10, height: 10,
                          position: 'relative', transform: 'none', top: 'auto', right: 'auto',
                          flexShrink: 0,
                        }}
                        title={port.description || port.name}
                        onClick={(e) => { e.stopPropagation(); data.onPortEdit(id, port.id); }}
                      />
                    </div>
                    {plotWidget && (
                      <div className="mt-1 mb-1 w-full">
                        <PlotWidget data={executionResult?.inputs?.[port.id]} />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          {/* Memory-feedback hint -- this node's own persisted value breaks any cycle automatically, no manual edge marking needed */}
          {(graphNode.inputs.length > 0 && graphNode.outputs.length > 0) && (
            <p className="text-xs mt-2 px-1" style={{ color: DIMMER }}>
              Tip: this node remembers its own value, so a feedback edge into it (e.g. AI → text window) breaks the cycle automatically.
            </p>
          )}
          {executionResult?.status === 'success' && (
            <div className="text-xs mt-1 px-1 py-0.5 rounded"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac', maxHeight: 40, overflow: 'hidden' }}>
              {JSON.stringify(executionResult.outputs).slice(0, 80)}
            </div>
          )}
          {executionResult?.status === 'error' && (
            <div className="text-xs mt-1 px-1 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
              {executionResult.error?.slice(0, 80)}
            </div>
          )}
        </div>
      ) : (
      <div className="px-3 py-2 flex flex-col gap-1">
        {/* Inputs */}
        {graphNode.inputs.map((port) => {
          // No plot preview here: this arm only renders when `isGuiLike` is
          // false, so the lookup that used to sit here could never match. GUI
          // nodes render their plots in the isGuiLike arm above.
          return (
            <React.Fragment key={port.id}>
              <div className="relative flex items-center gap-1.5" style={{ marginLeft: -12 }}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.id}
                  style={{
                    background: port.multi ? '#a78bfa' : ACCENT,
                    border: '2px solid #312e81',
                    width: 10,
                    height: 10,
                    position: 'relative',
                    transform: 'none',
                    top: 'auto',
                    left: 'auto',
                    flexShrink: 0,
                  }}
                  title={port.description || port.name}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onPortEdit(id, port.id);
                  }}
                />
                <span className="text-xs" style={{ color: MUTED }}>
                  {port.name}
                  {port.multi && <span title="Multi-input"> ∞</span>}
                </span>
              </div>
            </React.Fragment>
          );
        })}

        {/* Config preview */}
        {graphNode.config.value && (
          <div
            className="text-xs truncate mt-1 px-1 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.05)', color: MUTED }}
            title={graphNode.config.value}
          >
            {graphNode.config.value.length > 30
              ? graphNode.config.value.slice(0, 30) + '…'
              : graphNode.config.value}
          </div>
        )}

        {/* Persisted data-node content preview */}
        {graphNode.node_type === 'data' && graphNode.config.data_value != null && (
          <div
            className="text-xs truncate mt-1 px-1 py-0.5 rounded font-mono"
            style={{ background: 'rgba(255,255,255,0.05)', color: MUTED }}
            title={dataValuePreview(graphNode.config.data_value)}
          >
            {dataValuePreview(graphNode.config.data_value).slice(0, 30)}
          </div>
        )}

        {/* Execution output preview */}
        {executionResult?.status === 'success' && (
          <div
            className="text-xs mt-1 px-1 py-0.5 rounded"
            style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac', maxHeight: 60, overflow: 'hidden' }}
          >
            {JSON.stringify(executionResult.outputs).slice(0, 100)}
          </div>
        )}
        {executionResult?.status === 'error' && (
          <div
            className="text-xs mt-1 px-1 py-0.5 rounded"
            style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}
          >
            {executionResult.error?.slice(0, 80)}
          </div>
        )}

        {/* Outputs */}
        {graphNode.outputs.map((port) => (
          <div key={port.id} className="relative flex items-center justify-end gap-1.5" style={{ marginRight: -12 }}>
            <span className="text-xs" style={{ color: MUTED }}>
              {port.name}
              {port.multi && <span title="Multi-output"> ∞</span>}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                background: port.multi ? '#a78bfa' : ACCENT,
                border: '2px solid #312e81',
                width: 10,
                height: 10,
                position: 'relative',
                transform: 'none',
                top: 'auto',
                right: 'auto',
                flexShrink: 0,
              }}
              title={port.description || port.name}
              onClick={(event) => {
                event.stopPropagation();
                data.onPortEdit(id, port.id);
              }}
            />
          </div>
        ))}
      </div>
      )}

      {/* Type badge */}
      <div
        className="px-3 py-1 text-xs"
        style={{ color: DIMMER, background: 'rgba(0,0,0,0.2)', textAlign: 'right' }}
      >
        {NODE_TYPE_LABELS[graphNode.node_type]}
      </div>
    </div>
  );
});

GraphNodeComponent.displayName = 'GraphNodeComponent';

export default GraphNodeComponent;
