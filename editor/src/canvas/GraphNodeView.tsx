import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import type { RFNodeData } from './nodeData';
import { useGraphStore } from '@/store/graphStore';
import { NODE_UIS, WIDGET_UIS } from '@/elements/registry';
import { ACCENT, DANGER, DANGER_TEXT, DIMMER, HEADER, HOVER, LINE, MUTED, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '@/ui/theme';
import { delivered } from './executionStatus';
import { widgetFiresRun, widgetOfPort } from '@/elements/nodes/gui/guiWidgets';
import { RUN_PORT } from '@engine/execution/triggers.ts';

/**
 * How an event looks, wherever one appears: the amber diamond of the run port.
 *
 * A page has two sorts of output and they used to be drawn with the same green
 * dot -- a button, which *starts* the graph and carries no value worth having,
 * and a field, whose value is read when something else starts it. Which one a
 * block is decides what the whole tool does when someone uses it, so it is
 * worth a shape of its own, and the shape it gets is the one already meaning
 * "a run begins here" on the top of every other node.
 */
const EVENT_PORT: React.CSSProperties = {
  background: '#f59e0b', border: '2px solid #78350f', borderRadius: 2, transform: 'rotate(45deg)',
};

// Colour AND a glyph: a red/green 8px dot is unreadable both to a screen
// reader and to a colour-blind user scanning a canvas for the failed node.
const statusStyles: Record<string, { color: string; glyph: string }> = {
  success: { color: SUCCESS, glyph: '✓' },
  error: { color: DANGER, glyph: '!' },
  running: { color: '#f59e0b', glyph: '…' },
  pending: { color: '#6b7280', glyph: '·' },
  // Did not run this round: its ◆ stayed shut, and what it made before stands.
  held: { color: '#6b7280', glyph: '‖' },
};

const GraphNodeView = memo(({ id, data, selected }: NodeProps<RFNodeData>) => {
  const { graphNode, onEdit, onDelete } = data;
  const executionResult = useGraphStore((s) =>
    s.executionResult?.node_results.find((r) => r.node_id === id)
  );

  const ui = NODE_UIS[graphNode.node_type];
  const bgColor = ui?.color ?? SURFACE;
  const icon = ui?.icon ?? '⬜';
  const status = executionResult ? statusStyles[executionResult.held ? 'held' : executionResult.status] : undefined;
  const statusTitle = executionResult?.held
    ? 'Did not run this round: what it produced in an earlier round stands'
    : executionResult?.status;
  const statusColor = status?.color;
  const isGuiLike = ui?.holdsWidgets ?? false;
  const summary = ui?.canvasSummary?.(graphNode);

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
      // Anywhere on the node, as the palette's hint says -- not only on its title bar.
      onDoubleClick={handleEdit}
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
        style={{ background: HEADER }}
      >
        <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1 mr-2">
          {/* The run port: every node has it and no node declares it. A page is
              the one kind that does not -- it is where events come from, not
              where they go. */}
          {!isGuiLike && (
            <Handle
              type="target"
              position={Position.Top}
              id={RUN_PORT}
              style={{
                background: '#f59e0b', border: '2px solid #78350f',
                width: 10, height: 10, borderRadius: 2,
                position: 'relative', transform: 'rotate(45deg)', top: 'auto', left: 'auto',
                flexShrink: 0,
              }}
              title="Start here. Wire a button — or any block that starts the graph — to this, and using it runs the graph from this node on. It carries no value."
            />
          )}
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
              aria-label={`Last run: ${statusTitle}`}
              title={statusTitle}
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
              {graphNode.outputs.map((port) => {
                // A block that starts the graph is an event, not a value that
                // happens to be read: drawn as one, and said in words beside it.
                const block = widgetOfPort(graphNode, port.id);
                const fires = block ? widgetFiresRun(block) : false;
                return (
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
                        ...(fires ? EVENT_PORT : {}),
                      }}
                      title={fires
                        ? `${port.description || port.name} — using this block starts the graph, from whatever this is wired to.`
                        : (port.description || port.name)}
                      onClick={(e) => { e.stopPropagation(); data.onPortEdit(id, port.id); }}
                    />
                    <span className="text-xs truncate" style={{ color: fires ? '#fbbf24' : '#86efac' }}>
                      {fires && <span title="Using this block starts the graph">⚡ </span>}
                      {port.name}{port.multi && <span title="Multi"> ∞</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Right column: target (input) ports — handles on the right edge */}
            <div className="flex flex-col gap-1 items-end">
              <span className="text-xs font-semibold mb-0.5" style={{ color: DIMMER }}>IN ←</span>
              {graphNode.inputs.map((port) => {
                // Whether anything is previewed under this port is the widget
                // element's answer, not this component's: it used to look for
                // `kind === 'plot_window'` by name, which is a widget-kind
                // switch inside a shared renderer.
                const behind = widgetOfPort(graphNode, port.id);
                const previewWidget = behind && WIDGET_UIS[behind.kind]?.CanvasPreview ? behind : undefined;
                const CanvasPreview = previewWidget
                  ? WIDGET_UIS[previewWidget.kind].CanvasPreview
                  : undefined;
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
                    {CanvasPreview && (
                      <div className="mt-1 mb-1 w-full">
                        <CanvasPreview data={executionResult?.display?.[previewWidget!.id] ?? executionResult?.inputs?.[port.id]} />
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
          {executionResult && delivered(executionResult.status) && (
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
            style={{ background: HOVER, color: MUTED }}
            title={graphNode.config.value}
          >
            {graphNode.config.value.length > 30
              ? graphNode.config.value.slice(0, 30) + '…'
              : graphNode.config.value}
          </div>
        )}

        {/* What the node holds, when it says: a data node's remembered value. */}
        {summary !== undefined && (
          <div
            className="text-xs truncate mt-1 px-1 py-0.5 rounded font-mono"
            style={{ background: HOVER, color: MUTED }}
            title={summary}
          >
            {summary.slice(0, 30)}
          </div>
        )}

        {/* Execution output preview */}
        {executionResult && delivered(executionResult.status) && (
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
        style={{ color: DIMMER, background: HEADER, textAlign: 'right' }}
      >
        {ui?.label}
      </div>
    </div>
  );
});

GraphNodeView.displayName = 'GraphNodeView';

export default GraphNodeView;
