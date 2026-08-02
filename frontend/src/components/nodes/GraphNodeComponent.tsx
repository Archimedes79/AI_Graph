import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import type { RFNodeData } from '../../types/graph';
import { NODE_TYPE_COLORS, NODE_TYPE_ICON, NODE_TYPE_LABELS } from '../../utils/nodeDefaults';
import { useGraphStore } from '../../store/graphStore';
import PlotWidget from '../PlotWidget';

const statusColors: Record<string, string> = {
  success: '#22c55e',
  error: '#ef4444',
  running: '#f59e0b',
  pending: '#6b7280',
};

const GraphNodeComponent = memo(({ id, data, selected }: NodeProps<RFNodeData>) => {
  const { graphNode, onEdit, onDelete } = data;
  const executionResult = useGraphStore((s) =>
    s.executionResult?.node_results.find((r) => r.node_id === id)
  );

  const bgColor = NODE_TYPE_COLORS[graphNode.node_type] ?? '#1a1d2e';
  const icon = NODE_TYPE_ICON[graphNode.node_type] ?? '⬜';
  const statusColor = executionResult ? statusColors[executionResult.status] : undefined;
  const isGui = graphNode.node_type === 'gui';

  const handleEdit = useCallback(() => onEdit(id), [id, onEdit]);
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(id);
    },
    [id, onDelete]
  );

  return (
    <div
      className="rounded-lg overflow-hidden shadow-lg select-none"
      style={
        isGui
          ? { background: bgColor, border: `2px solid ${statusColor ?? '#2d3148'}`, width: '100%', height: '100%' }
          : { background: bgColor, border: `2px solid ${statusColor ?? '#2d3148'}`, minWidth: 180, maxWidth: 240 }
      }
    >
      {isGui && (
        <NodeResizer
          isVisible={selected}
          minWidth={220}
          minHeight={140}
          lineStyle={{ borderColor: '#6366f1' }}
          handleStyle={{ background: '#6366f1', width: 8, height: 8 }}
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
            style={{ color: '#e2e8f0' }}
          >
            {graphNode.label}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {statusColor && (
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: statusColor }}
              title={executionResult?.status}
            />
          )}
          <button
            onClick={handleEdit}
            className="text-xs px-1.5 py-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
            style={{ background: '#6366f1', color: 'white' }}
            title="Edit node"
          >
            ✏️
          </button>
          <button
            onClick={handleDelete}
            className="text-xs px-1.5 py-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
            style={{ background: '#ef4444', color: 'white' }}
            title="Delete node"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Ports — GUI nodes get a special two-column layout: outputs left, inputs right */}
      {isGui ? (
        <div className="px-3 py-2">
          <div className="grid grid-cols-2 gap-x-2">
            {/* Left column: source (output) ports — handles on the left edge */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold mb-0.5" style={{ color: '#475569' }}>→ OUT</span>
              {graphNode.outputs.map((port) => (
                <div key={port.id} className="relative flex items-center gap-1.5" style={{ marginLeft: -12 }}>
                  <Handle
                    type="source"
                    position={Position.Left}
                    id={port.id}
                    style={{
                      background: port.multi ? '#a78bfa' : '#22c55e',
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
              <span className="text-xs font-semibold mb-0.5" style={{ color: '#475569' }}>IN ←</span>
              {graphNode.inputs.map((port) => {
                const plotWidget = graphNode.config.gui_widgets.find(
                  (w) => w.kind === 'plot_window' && `${w.id}_in` === port.id
                );
                return (
                  <React.Fragment key={port.id}>
                    <div className="relative flex items-center gap-1.5" style={{ marginRight: -12 }}>
                      <span className="text-xs truncate" style={{ color: '#94a3b8' }}>
                        {port.name}{port.multi && <span title="Multi"> ∞</span>}
                      </span>
                      <Handle
                        type="target"
                        position={Position.Right}
                        id={port.id}
                        style={{
                          background: port.multi ? '#a78bfa' : '#6366f1',
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
          {/* t+1 hint */}
          {(graphNode.inputs.length > 0 && graphNode.outputs.length > 0) && (
            <p className="text-xs mt-2 px-1" style={{ color: '#475569' }}>
              Tip: to feed results back in (e.g. AI → text window), mark that edge as <strong style={{ color: '#f59e0b' }}>t+1</strong> in the Connector Editor to break the cycle.
            </p>
          )}
          {executionResult?.status === 'success' && (
            <div className="text-xs mt-1 px-1 py-0.5 rounded"
              style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac', maxHeight: 40, overflow: 'hidden' }}>
              {JSON.stringify(executionResult.outputs).slice(0, 80)}
            </div>
          )}
          {executionResult?.status === 'error' && (
            <div className="text-xs mt-1 px-1 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
              {executionResult.error?.slice(0, 80)}
            </div>
          )}
        </div>
      ) : (
      <div className="px-3 py-2 flex flex-col gap-1">
        {/* Inputs */}
        {graphNode.inputs.map((port) => {
          const plotWidget = isGui
            ? graphNode.config.gui_widgets.find((w) => w.kind === 'plot_window' && `${w.id}_in` === port.id)
            : undefined;
          return (
            <React.Fragment key={port.id}>
              <div className="relative flex items-center gap-1.5" style={{ marginLeft: -12 }}>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={port.id}
                  style={{
                    background: port.multi ? '#a78bfa' : '#6366f1',
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
                <span className="text-xs" style={{ color: '#94a3b8' }}>
                  {port.name}
                  {port.multi && <span title="Multi-input"> ∞</span>}
                </span>
              </div>
              {plotWidget && (
                <div className="mt-1 mb-1" style={{ marginLeft: 0 }}>
                  <PlotWidget data={executionResult?.inputs?.[port.id]} />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Config preview */}
        {graphNode.config.value && (
          <div
            className="text-xs truncate mt-1 px-1 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}
            title={graphNode.config.value}
          >
            {graphNode.config.value.length > 30
              ? graphNode.config.value.slice(0, 30) + '…'
              : graphNode.config.value}
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
            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}
          >
            {executionResult.error?.slice(0, 80)}
          </div>
        )}

        {/* Outputs */}
        {graphNode.outputs.map((port) => (
          <div key={port.id} className="relative flex items-center justify-end gap-1.5" style={{ marginRight: -12 }}>
            <span className="text-xs" style={{ color: '#94a3b8' }}>
              {port.name}
              {port.multi && <span title="Multi-output"> ∞</span>}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={port.id}
              style={{
                background: port.multi ? '#a78bfa' : '#6366f1',
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
        style={{ color: '#475569', background: 'rgba(0,0,0,0.2)', textAlign: 'right' }}
      >
        {NODE_TYPE_LABELS[graphNode.node_type]}
      </div>
    </div>
  );
});

GraphNodeComponent.displayName = 'GraphNodeComponent';

export default GraphNodeComponent;
