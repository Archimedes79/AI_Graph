import React, { useState, useEffect } from 'react';
import type { GraphNode } from '../types/graph';
import { useGraphStore } from '../store/graphStore';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { inputPortsForMode } from '../elements/input/inputElement';
import { NODE_ELEMENTS } from '../elements/registry';
import Modal from './Modal';
import { useGenerate } from '../elements/shared/useGenerate';
import { buildGeneration, nodeFields } from '../elements/shared/generation';
import { connectedFormatContext, lastRunContext, lastRunInputs } from '../elements/shared/generationContext';
import OutputFormatEditor from '../elements/shared/OutputFormatEditor';
import AuthoredFileOption from '../elements/shared/AuthoredFileOption';
import WidgetOutputSummary from '../elements/gui/WidgetOutputSummary';
import { connectedOutputDataNodes } from '../elements/data/dataElement';
import { ACCENT, ACCENT_TEXT, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT } from '../ui/theme';

interface NodeEditorProps {
  nodeId: string;
  onClose: () => void;
}

export default function NodeEditor({ nodeId, onClose }: NodeEditorProps) {
  const rfNode = useGraphStore((s) => s.rfNodes.find((n) => n.id === nodeId));
  const updateNode = useGraphStore((s) => s.updateNode);
  const graphNodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const graphEdges = useGraphStore((s) => s.rfEdges);
  // The last run's per-node values: the best generation context available, and
  // it was sitting in the store unused.
  const executionResult = useGraphStore((s) => s.executionResult);

  const [node, setNode] = useState<GraphNode | null>(null);
  // One state machine for all four ✨ Generate buttons in this editor.
  const generate = useGenerate();
  const generating = generate.busy;
  const genMessage = generate.message();
  const [activeTab, setActiveTab] = useState<'config' | 'preview'>('config');

  useEffect(() => {
    if (rfNode) {
      setNode(JSON.parse(JSON.stringify(rfNode.data.graphNode)));
    }
  }, [rfNode]);

  if (!node) return null;

  // Every node type has the same two tabs. What a node emits used to be a
  // third one that two of six types had -- an editable contract for ai/code, a
  // read-only summary for gui, nothing for the rest. It is a declaration like
  // any other now (`outputContract`), so it sits in Config under the body and
  // the tab bar stopped depending on the node type.
  const element = NODE_ELEMENTS[node.node_type];
  const tabs = ['config', 'preview'] as const;
  const effectiveTab = (tabs as readonly string[]).includes(activeTab) ? activeTab : 'config';

  const save = () => {
    updateNode(nodeId, node);
    onClose();
  };

  /**
   * Close, but not silently over unsaved work.
   *
   * Everything edited here -- including a snippet an AI just spent a minute
   * generating -- lives in this modal's draft until Save. Cancel and Escape
   * used to discard it without a word, so "✅ Transform generated!" followed by
   * Escape lost the code and left no trace of why.
   */
  const closeWithGuard = () => {
    const stored = rfNode ? JSON.stringify(rfNode.data.graphNode) : '';
    if (JSON.stringify(node) !== stored
        && !window.confirm('Discard the changes to this node?')) return;
    onClose();
  };

  const setConfig = (key: string, value: unknown) => {
    setNode((prev) =>
      prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev
    );
  };

  /**
   * Everything the generator should know beyond the user's own description:
   * what the neighbours declare, and what actually flowed through this node the
   * last time the graph ran.
   */
  const surroundingContext = () => [
    connectedFormatContext(node.id, graphNodes, graphEdges),
    lastRunContext(node.id, executionResult),
  ].filter(Boolean).join('\n\n');

  const setDescription = (value: string) =>
    setNode((prev) => (prev ? { ...prev, description: value } : prev));

  /**
   * The one ✨ Generate handler.
   *
   * There were four here -- code, system prompt, data format, file selector --
   * and every ConfigEditor was handed all of them so it could use the one it
   * recognised. They differed only in the things `ElementGeneration` now names,
   * so the element declares them and this shell no longer knows which node type
   * it is looking at. Adding a generating node type adds nothing to this file.
   */
  const generation = element.generation;
  const canGenerate = !!generation && (generation.available?.(node) ?? true);
  const handleGenerate = () => {
    if (!generation) return;
    generate.run(buildGeneration({
      element: node.node_type,
      generation,
      subject: node,
      fields: nodeFields(node, setConfig, setDescription),
      ports: { inputs: node.inputs.map((p) => p.id), outputs: node.outputs.map((p) => p.id) },
      language: node.config.language,
      exampleFile: node.config.example_file,
      graphContext: surroundingContext(),
      // The same values `lastRunContext` renders as prose, raw: the backend runs
      // the generated function against them and repairs it once if it fails.
      sampleInputs: lastRunInputs(node.id, executionResult),
    }));
  };

  const applyDataFormat = (format: GraphNode['config']['data_format']) => {
    const structured = format === 'structure';
    const dataType = structured ? 'json' : 'text';
    const portFormat = structured ? 'application/json' : 'text/plain';
    setNode((previous) => previous ? {
      ...previous,
      inputs: previous.inputs.map((port) => ({ ...port, data_type: dataType, format: portFormat })),
      outputs: previous.outputs.map((port) => ({ ...port, data_type: dataType, format: portFormat })),
      config: { ...previous.config, data_format: format },
    } : previous);
  };

  const setDataDebugDirectory = (path: string) => {
    setNode((previous) => previous ? {
      ...previous,
      outputs: previous.outputs.map((port) => port.id === 'output' ? { ...port, debug_directory: path || undefined } : port),
    } : previous);
  };

  const ConfigEditor = element.ConfigEditor;

  const applyWidgets = (nextWidgets: GraphNode['config']['gui_widgets']) => {
    setNode((prev) => {
      if (!prev) return prev;
      return syncGuiNodePorts({ ...prev, config: { ...prev.config, gui_widgets: nextWidgets } });
    });
  };

  const applyInputMode = (mode: 'text' | 'file' | 'directory') => {
    setNode((prev) => {
      if (!prev) return prev;
      const ports = inputPortsForMode(mode);
      return {
        ...prev,
        inputs: ports.inputs,
        outputs: ports.outputs,
        config: { ...prev.config, input_mode: mode },
      };
    });
  };

  const tabBar = (
    <div className="flex border-b" style={{ borderColor: LINE }}>
      {tabs.map((tab) => (
        <button
          key={tab}
          className="px-5 py-3 text-sm capitalize transition-colors"
          style={{
            color: effectiveTab === tab ? ACCENT : MUTED,
            borderBottom: effectiveTab === tab ? `2px solid ${ACCENT}` : '2px solid transparent',
            background: 'transparent',
          }}
          onClick={() => setActiveTab(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );

  return (
    <Modal
      title={
        <input
          className="text-lg font-bold bg-transparent border-none outline-none w-full"
          style={{ color: TEXT }}
          value={node.label}
          aria-label="Node label"
          onChange={(e) => setNode((prev) => prev ? { ...prev, label: e.target.value } : prev)}
        />
      }
      onClose={closeWithGuard}
      maxWidth="max-w-2xl"
      scrollBody
      // The editor holds unsaved edits; a stray backdrop click must not throw
      // them away. Escape is left working because it is what Cancel does.
      dismissOnBackdrop={false}
      subHeader={tabBar}
      footer={
        <>
          <button
            onClick={closeWithGuard}
            className="px-4 py-2 text-sm rounded-lg"
            style={NEUTRAL_BUTTON}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 text-sm rounded-lg font-semibold"
            style={PRIMARY_BUTTON}
          >
            Save
          </button>
        </>
      }
    >
      <div className="px-6 py-5">
          {node.node_type !== 'code' && node.node_type !== 'ai' && node.node_type !== 'data' && (
            <div className="mb-4">
              <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                style={{ ...FIELD, minHeight: 64 }}
                value={node.description}
                onChange={(e) => setNode((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                placeholder="Document what this node does…"
              />
            </div>
          )}

          {effectiveTab === 'config' && (
            <div className="space-y-4">
              <ConfigEditor
                node={node}
                setConfig={setConfig}
                setDescription={(value: string) => setNode((prev) => (prev ? { ...prev, description: value } : prev))}
                generating={generating}
                onGenerate={handleGenerate}
                canGenerate={canGenerate}
                applyMode={applyInputMode}
                applyDataFormat={applyDataFormat}
                setDataDebugDirectory={setDataDebugDirectory}
                applyWidgets={applyWidgets}
                contextFile={node.config.example_file ?? ''}
                onContextFileChange={(path: string) => setConfig('example_file', path)}
              />

              {element.outputContract === 'format' && (
                <OutputFormatEditor
                  node={node}
                  setConfig={setConfig}
                  connectedDataNodes={connectedOutputDataNodes(node.id, graphNodes, graphEdges)}
                />
              )}
              {element.outputContract === 'widgets' && <WidgetOutputSummary node={node} />}

              {(() => {
                const fileSpec = element.authoredFile?.(node);
                return fileSpec ? (
                  <AuthoredFileOption
                    label={node.label}
                    fileName={node.config.code_file ?? ''}
                    extension={fileSpec.extension}
                    what={fileSpec.what}
                    folderHint="<graph>.nodes/"
                    onChange={(name) => setConfig('code_file', name)}
                  />
                ) : null;
              })()}

              {genMessage && (
                <div className="text-sm px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: ACCENT_TEXT }}>
                  {genMessage}
                </div>
              )}
            </div>
          )}

          {effectiveTab === 'preview' && (
            <div>
              <pre
                className="text-xs rounded-lg p-4 overflow-auto"
                style={{ background: SUNKEN, color: MUTED, border: `1px solid ${LINE}`, maxHeight: 400 }}
              >
                {JSON.stringify(node, null, 2)}
              </pre>
            </div>
          )}
      </div>
    </Modal>
  );
}
