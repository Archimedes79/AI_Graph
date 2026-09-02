import React, { useState, useEffect } from 'react';
import type { GraphNode } from '../types/graph';
import { useGraphStore } from '../store/graphStore';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { derivedNodePorts } from '../utils/guiWidgets';
import { NODE_ELEMENTS } from '../elements/registry';
import Modal from './Modal';
import { useGenerate } from '../elements/shared/useGenerate';
import { buildGeneration, nodeFields } from '../elements/shared/generation';
import { connectedFormatContext, inputSources, lastRunContext, lastRunInputs } from '../elements/shared/generationContext';
import OutputFormatEditor from '../elements/shared/OutputFormatEditor';
import AuthoredFileOption from '../elements/shared/AuthoredFileOption';
import { nodeLogic } from '../elements/shared/logic';
import GenerationTranscript, { GenerationReport } from '../elements/shared/GenerationTranscript';
import WidgetOutputSummary from '@engine/elements/gui/editor/WidgetOutputSummary';
import { connectedOutputDataNodes } from '@engine/elements/data/editor/definition';
import { ACCENT, ACCENT_FILL, ACCENT_TEXT, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT } from '../ui/theme';

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

  useEffect(() => {
    if (rfNode) {
      setNode(JSON.parse(JSON.stringify(rfNode.data.graphNode)));
    }
  }, [rfNode]);

  if (!node) return null;

  // No tabs. There were two: Config, and a Preview that printed the node's own
  // JSON. Nobody edits a graph by reading its serialization -- it answered a
  // question ("what did that setting actually store?") that the file on disk
  // answers better, and it cost every node a tab bar to get to the one tab that
  // does something. What a node emits was a third tab for two of six types; it
  // is a declaration now (`outputContract`) and sits in Config under the body.
  const element = NODE_ELEMENTS[node.node_type];

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
  const fields = nodeFields(node, setConfig, setDescription);
  const handleGenerate = () => {
    if (!generation) return;
    generate.run(buildGeneration({
      element: node.node_type,
      generation,
      subject: node,
      fields,
      ports: { inputs: node.inputs.map((p) => p.id), outputs: node.outputs.map((p) => p.id) },
      exampleFile: node.config.example_file,
      graphContext: surroundingContext(),
      // The same values `lastRunContext` renders as prose, raw: the backend runs
      // the generated function against them and repairs it once if it fails.
      sampleInputs: lastRunInputs(node.id, executionResult),
      inputSources: inputSources(node.id, graphNodes, graphEdges),
      recordMeasuredOutput: true,
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
      // Changing the mode changes the ports, and the element is what knows
      // which: a folder emits files and count, a file content and path. This
      // used to be a second list here, which is how one of them came to
      // disagree with what the node actually emits.
      const next = { ...prev, config: { ...prev.config, input_mode: mode } };
      const ports = derivedNodePorts(next);
      return ports ? { ...next, inputs: ports.inputs, outputs: ports.outputs } : next;
    });
  };


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
          {/* Only for elements whose own editor does not already ask what the
              node is for. An ai node's description IS its generation prompt, so
              drawing this above it showed the same box twice. */}
          {!NODE_ELEMENTS[node.node_type]?.ownsDescription && (
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

          <GenerationReport calls={generate.transcript()}>
          <div className="space-y-4">
              {ConfigEditor && <ConfigEditor
                node={node}
                setConfig={setConfig}
                setDescription={(value: string) => setNode((prev) => (prev ? { ...prev, description: value } : prev))}
                generation={generation}
                fields={fields}
                generating={generating}
                message={genMessage}
                onGenerate={handleGenerate}
                canGenerate={canGenerate}
                applyMode={applyInputMode}
                applyDataFormat={applyDataFormat}
                setDataDebugDirectory={setDataDebugDirectory}
                applyWidgets={applyWidgets}
                contextFile={node.config.example_file ?? ''}
                onContextFileChange={(path: string) => setConfig('example_file', path)}
              />}

              {element.outputContract === 'format' && (
                <OutputFormatEditor
                  node={node}
                  setConfig={setConfig}
                  connectedDataNodes={connectedOutputDataNodes(node.id, graphNodes, graphEdges)}
                />
              )}
              {element.outputContract === 'widgets' && <WidgetOutputSummary node={node} />}

              {(() => {
                const logic = nodeLogic(node);
                return logic ? (
                  <AuthoredFileOption
                    label={node.label}
                    fileName={node.config.code_file ?? ''}
                    extension={logic.extension}
                    what={logic.what}
                    folderHint="<graph>.nodes/"
                    onChange={(name) => setConfig('code_file', name)}
                  />
                ) : null;
              })()}

              {/* An element with no ✨ button of its own can still have something
                  to report -- the message is drawn next to the button otherwise. */}
              {genMessage && !generation && (
                <div className="text-sm px-3 py-2 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
                  {genMessage}
                </div>
              )}
              {!generation && <GenerationTranscript />}
          </div>
          </GenerationReport>
      </div>
    </Modal>
  );
}
