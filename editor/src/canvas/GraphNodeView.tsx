import React, { memo, useCallback, useState } from 'react';
import { Handle, Position, NodeProps, NodeResizer } from 'reactflow';
import type { RFNodeData } from '@/store/nodeData';
import { useGraphStore } from '@/store/graphStore';
import { NODE_BUILDERS } from '@/elements/registry';
import { errorLine } from '@/elements/resultPreview';
import { ACCENT, DANGER, DANGER_TEXT, DIMMER, HEADER, HOVER, LINE, MUTED, PRIMARY_BUTTON, SUCCESS, SUNKEN, SURFACE, TEXT } from '@/ui/theme';
import { hasOutputs } from '@/store/executionStatus';
import { showsPage, widgetFiresRun, widgetOfPort } from '@/document/guiWidgets';
import { carriesFiles, dropExample, droppedFile } from '@/authoring/droppedFile';
import { errorText } from '@/api/errorText';
import { RUN_PORT } from '@engine/execution/triggers.ts';
import ResultPreview, { ErrorPreview } from './ResultPreview';

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
  const { graphNode } = data;
  const setEditingNode = useGraphStore((s) => s.setEditingNode);
  const deleteNode = useGraphStore((s) => s.deleteNode);
  const executionResult = useGraphStore((s) =>
    s.executionResult?.node_results.find((r) => r.node_id === id)
  );

  const builder = NODE_BUILDERS[graphNode.node_type];
  const bgColor = builder?.color ?? SURFACE;
  const icon = builder?.icon ?? '⬜';
  const status = executionResult ? statusStyles[executionResult.held ? 'held' : executionResult.status] : undefined;
  const statusTitle = executionResult?.held
    ? 'Did not run this round: what it produced in an earlier round stands'
    : executionResult?.status;
  const statusColor = status?.color;
  const isGuiLike = showsPage(graphNode.node_type);
  const summary = builder?.canvasSummary?.(graphNode);
  // What it made last, beside the port each value stands at: the element
  // says which port and how the value reads. Faded while it stood still.
  const previews = executionResult && hasOutputs(executionResult) && builder
    ? builder.resultPreviews(graphNode, executionResult) : undefined;
  const held = executionResult?.held;
  const failure = executionResult?.status === 'error'
    ? <ErrorPreview line={errorLine(executionResult.error)} error={executionResult.error ?? ''} />
    : null;

  const handleEdit = useCallback(() => setEditingNode(id), [id, setEditingNode]);

  // A file dropped on a node fills what the element says (`dropPort`): the
  // example of a node built in the four steps, what a data node holds. No
  // dialog on the way; its own dialog opens on it (`dropExample`).
  const dropInto = builder?.dropPort(graphNode);
  const [fileOver, setFileOver] = useState(false);
  const [dropFailed, setDropFailed] = useState('');
  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!dropInto || !carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
  }, [dropInto]);
  const onDrop = useCallback((event: React.DragEvent) => {
    setFileOver(false);
    const file = dropInto ? droppedFile(event.dataTransfer) : undefined;
    if (!file || !dropInto) return;
    // Not the canvas's, and not the window's: this drop is not a graph to open.
    event.preventDefault();
    event.stopPropagation();
    setDropFailed('');
    dropExample(id, dropInto, file).catch((reason) => setDropFailed(errorText(reason, 'The file could not be read.')));
  }, [id, dropInto]);
  // The ✕ sits a few pixels from ✏️, deleting is immediate, and it silently
  // takes every attached edge with it -- so a node that is wired into the
  // graph asks first; Ctrl+Z is not where anyone should find that out. An
  // unconnected node deletes straight away, because that is the case where a
  // confirmation is just noise.
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
      deleteNode(id);
    },
    [connectedEdgeCount, graphNode.label, id, deleteNode]
  );

  return (
    <div
      className="rounded-lg overflow-hidden shadow-lg select-none"
      // Anywhere on the node, as the palette's hint says -- not only on its title bar.
      onDoubleClick={handleEdit}
      onDragOver={onDragOver}
      onDragLeave={() => setFileOver(false)}
      onDrop={onDrop}
      style={
        isGuiLike
          ? { background: bgColor, border: `2px solid ${statusColor ?? LINE}`, width: '100%', height: '100%' }
          : { background: bgColor, border: `2px solid ${fileOver ? ACCENT : statusColor ?? LINE}`, minWidth: 180, maxWidth: 240 }
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

      {/* Ports — the page gets a two-column layout: what its blocks hand on left, what they show right */}
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
                    />
                    <span className="text-xs truncate" style={{ color: fires ? '#fbbf24' : '#86efac' }}>
                      {fires && <span title="Using this block starts the graph">⚡ </span>}
                      {port.name}{port.multi && <span title="A list: takes or hands on several values"> ∞</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* Right column: target (input) ports — handles on the right edge */}
            <div className="flex flex-col gap-1 items-end">
              <span className="text-xs font-semibold mb-0.5" style={{ color: DIMMER }}>IN ←</span>
              {graphNode.inputs.map((port) => {
                // What the block fed here shows, as the block reads it: the
                // page's element answers, not a kind named in here.
                const preview = previews?.inputs[port.id];
                return (
                  <React.Fragment key={port.id}>
                    <div className="relative flex items-center gap-1.5" style={{ marginRight: -12 }}>
                      <span className="text-xs truncate" style={{ color: MUTED }}>
                        {port.name}{port.multi && <span title="A list: takes or hands on several values"> ∞</span>}
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
                      />
                    </div>
                    {preview && <ResultPreview preview={preview} status={executionResult?.status} held={held} />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          {/* Memory-feedback hint -- this node's own persisted value breaks any cycle automatically, no manual edge marking needed */}
          {(graphNode.inputs.length > 0 && graphNode.outputs.length > 0) && (
            <p className="text-xs mt-2 px-1" style={{ color: DIMMER }}>
              Tip: the page remembers what it shows, so a wire back into it (AI → a text block) closes a loop without a cycle.
            </p>
          )}
          {failure && <div className="mt-1">{failure}</div>}
        </div>
      ) : (
      <div className="px-3 py-2 flex flex-col gap-1">
        {/* Inputs */}
        {graphNode.inputs.map((port) => {
          // What arrived here, where it is what the node hands on: an output node's result.
          const preview = previews?.inputs[port.id];
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
                />
                <span className="text-xs" style={{ color: MUTED }}>
                  {port.name}
                  {port.multi && <span title="Takes a list: several values, or one from each wired node"> ∞</span>}
                </span>
              </div>
              {preview && <ResultPreview preview={preview} status={executionResult?.status} held={held} />}
            </React.Fragment>
          );
        })}

        {/* What the node holds, when its element says: a data node's value, an
            input's text, where an output writes, when a trigger fires. */}
        {summary !== undefined && (
          <div
            className="text-xs truncate mt-1 px-1 py-0.5 rounded font-mono"
            style={{ background: HOVER, color: MUTED }}
            title={summary}
          >
            {summary.length > 30 ? `${summary.slice(0, 30)}…` : summary}
          </div>
        )}

        {failure}
        {/* A file dropped here that could not become its example, and why --
            whole, since it says what to do instead. */}
        {dropFailed && (
          <div className="text-xs mt-1 px-1 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: DANGER_TEXT }}>
            {dropFailed}
          </div>
        )}

        {/* Outputs, each with what came out of it last */}
        {graphNode.outputs.map((port) => (
          <React.Fragment key={port.id}>
            <div className="relative flex items-center justify-end gap-1.5" style={{ marginRight: -12 }}>
              <span className="text-xs" style={{ color: MUTED }}>
                {port.name}
                {port.multi && <span title="Hands on a list: the next node runs once per item, unless it takes the whole list"> ∞</span>}
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
              />
            </div>
            {previews?.outputs[port.id] && <ResultPreview preview={previews.outputs[port.id]} status={executionResult?.status} held={held} />}
          </React.Fragment>
        ))}
      </div>
      )}

      {/* Type badge */}
      <div
        className="px-3 py-1 text-xs"
        style={{ color: DIMMER, background: HEADER, textAlign: 'right' }}
      >
        {builder?.label}
      </div>
    </div>
  );
});

GraphNodeView.displayName = 'GraphNodeView';

export default GraphNodeView;
