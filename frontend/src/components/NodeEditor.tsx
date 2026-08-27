import React, { useState, useEffect } from 'react';
import type { GraphNode } from '../types/graph';
import { useGraphStore } from '../store/graphStore';
import { generateCode, generateDataFormat, generatePrompt } from '../utils/api';
import { genAI } from '../store/settingsStore';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { inputPortsForMode } from '../elements/input/inputElement';
import { NODE_ELEMENTS } from '../elements/registry';
import Modal from './Modal';
import { useGenerate } from '../elements/shared/useGenerate';
import { SELECTOR_CODE_CONTEXT } from '../elements/shared/generationContext';
import OutputFormatEditor from '../elements/shared/OutputFormatEditor';
import WidgetOutputSummary from '../elements/gui/WidgetOutputSummary';
import { connectedDataFormatContext, connectedOutputDataNodes } from '../elements/data/dataElement';
import { ACCENT, ACCENT_TEXT, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, SUNKEN, TEXT } from '../ui/theme';

interface NodeEditorProps {
  nodeId: string;
  onClose: () => void;
}

function outputFormatContext(config: GraphNode['config']): string {
  if (!config.output_format || config.output_format === 'text') return '';
  const customDescription = config.output_format === 'custom' && config.output_format_prompt
    ? ` (${config.output_format_prompt})`
    : '';
  return `The function must return output in ${config.output_format} format${customDescription}.`;
}

export default function NodeEditor({ nodeId, onClose }: NodeEditorProps) {
  const rfNode = useGraphStore((s) => s.rfNodes.find((n) => n.id === nodeId));
  const updateNode = useGraphStore((s) => s.updateNode);
  const graphNodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const graphEdges = useGraphStore((s) => s.rfEdges);

  const [node, setNode] = useState<GraphNode | null>(null);
  // One state machine for all four ✨ Generate buttons in this editor.
  const generate = useGenerate();
  const generating = generate.busy;
  const genMessage = generate.message();
  const [activeTab, setActiveTab] = useState<'config' | 'output' | 'preview'>('config');

  useEffect(() => {
    if (rfNode) {
      setNode(JSON.parse(JSON.stringify(rfNode.data.graphNode)));
    }
  }, [rfNode]);

  if (!node) return null;

  // ai/code are the only node types that actually consume `output_format` at
  // runtime/codegen time; gui/widget nodes' output is fully determined by
  // each widget's kind (see WidgetOutputSummary) -- everything else has no
  // output-format concept, so they get no Output tab at all.
  const showManualOutputTab = node.node_type === 'ai' || node.node_type === 'code';
  const showWidgetOutputTab = node.node_type === 'gui' || node.node_type === 'widget';
  const tabs = showManualOutputTab || showWidgetOutputTab
    ? (['config', 'output', 'preview'] as const)
    : (['config', 'preview'] as const);
  const effectiveTab = (tabs as readonly string[]).includes(activeTab) ? activeTab : 'config';

  const save = () => {
    updateNode(nodeId, node);
    onClose();
  };

  const setConfig = (key: string, value: unknown) => {
    setNode((prev) =>
      prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev
    );
  };

  const connectedDataContext = () => {
    return connectedDataFormatContext(node.id, graphNodes, graphEdges);
  };

  const handleGenerateCode = () => generate.run({
    guard: () => (node.config.code_prompt ?? '').trim() ? undefined : 'Please add a code generation prompt first.',
    pending: 'Generating code…',
    success: '✅ Code generated!',
    run: () => {
      const batchContext = node.config.batch_mode === 'whole_list'
        ? 'Batch mode is `whole_list`: multi input ports arrive in `inputs` as full lists. The generated function must handle or reduce those lists and must not reject an input merely because it is not a string.'
        : 'Batch mode is `per_item`: each multi input port is expanded before `run(inputs)` is called, so one scalar item from each multi port is passed per invocation.';
      return generateCode({
        description: (node.config.code_prompt ?? '').trim(),
        language: node.config.language,
        context: [batchContext, outputFormatContext(node.config), connectedDataContext()].filter(Boolean).join('\n'),
        context_file: node.config.config_context_file,
        inputs: node.inputs.map((p) => p.id),
        outputs: node.outputs.map((p) => p.id),
        ...genAI(),
      });
    },
    apply: (result) => setConfig('code', result.code),
  });

  const handleGeneratePrompt = () => generate.run({
    guard: () => node.description ? undefined : 'Please add a description first.',
    pending: 'Generating system prompt…',
    success: '✅ Prompt generated!',
    run: () => generatePrompt({
      description: node.description,
      context: [outputFormatContext(node.config), connectedDataContext()].filter(Boolean).join('\n'),
      context_file: node.config.config_context_file,
      ...genAI(),
    }),
    apply: (result) => setConfig('system_prompt', result.system_prompt),
  });

  const handleGenerateDataFormat = () => generate.run({
    guard: () => node.config.data_prompt?.trim() ? undefined : 'Please describe the data format first.',
    pending: 'Generating data format…',
    success: '✅ Data format generated!',
    run: () => generateDataFormat({
      description: (node.config.data_prompt ?? '').trim(),
      context: `Standard format family: ${node.config.data_format}.\n${connectedDataContext()}`,
      context_file: node.config.config_context_file,
      ...genAI(),
    }),
    apply: (result) => setConfig('data_format_prompt', result.output_format_prompt),
  });

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

  const ConfigEditor = NODE_ELEMENTS[node.node_type].ConfigEditor;

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

  const handleGenerateSelectorCode = () => generate.run({
    guard: () => (node.config.selector_prompt ?? '').trim() ? undefined : 'Please describe which files to select first.',
    pending: 'Generating file selector…',
    success: '✅ Selector generated!',
    run: () => generateCode({
      description: (node.config.selector_prompt ?? '').trim(),
      language: node.config.language || 'python',
      context: SELECTOR_CODE_CONTEXT,
      context_file: node.config.config_context_file,
      inputs: ['files'],
      outputs: ['files'],
      ...genAI(),
    }),
    apply: (result) => setConfig('selector_code', result.code),
  });

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
      onClose={onClose}
      maxWidth="max-w-2xl"
      scrollBody
      // The editor holds unsaved edits; a stray backdrop click must not throw
      // them away. Escape is left working because it is what Cancel does.
      dismissOnBackdrop={false}
      subHeader={tabBar}
      footer={
        <>
          <button
            onClick={onClose}
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
                handleGenerateSelectorCode={handleGenerateSelectorCode}
                applyMode={applyInputMode}
                handleGeneratePrompt={handleGeneratePrompt}
                handleGenerateCode={handleGenerateCode}
                handleGenerateDataFormat={handleGenerateDataFormat}
                applyDataFormat={applyDataFormat}
                setDataDebugDirectory={setDataDebugDirectory}
                applyWidgets={applyWidgets}
                contextFile={node.config.config_context_file ?? ''}
                onContextFileChange={(path: string) => setConfig('config_context_file', path)}
              />

              {genMessage && (
                <div className="text-sm px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: ACCENT_TEXT }}>
                  {genMessage}
                </div>
              )}
            </div>
          )}

          {effectiveTab === 'output' && (
            showWidgetOutputTab
              ? <WidgetOutputSummary node={node} />
              : <OutputFormatEditor node={node} setConfig={setConfig} connectedDataNodes={connectedOutputDataNodes(node.id, graphNodes, graphEdges)} />
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
