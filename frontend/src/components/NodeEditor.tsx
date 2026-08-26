import React, { useState, useEffect } from 'react';
import type { GraphNode } from '../types/graph';
import { useGraphStore } from '../store/graphStore';
import { generateCode, generateDataFormat, generatePrompt } from '../utils/api';
import { genAI } from '../store/settingsStore';
import { syncGuiNodePorts } from '../utils/guiWidgets';
import { inputPortsForMode } from '../elements/input/inputElement';
import { NODE_ELEMENTS } from '../elements/registry';
import OutputFormatEditor from '../elements/shared/OutputFormatEditor';
import WidgetOutputSummary from '../elements/gui/WidgetOutputSummary';
import { connectedDataFormatContext } from '../elements/data/dataElement';

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
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');
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

  const handleGenerateCode = async () => {
    const prompt = (node.config.code_prompt ?? '').trim();
    if (!prompt) {
      setGenMessage('Please add a code generation prompt first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating code…');
    try {
      const inputNames = node.inputs.map((p) => p.id);
      const outputNames = node.outputs.map((p) => p.id);
      const batchContext = node.config.batch_mode === 'whole_list'
        ? 'Batch mode is `whole_list`: multi input ports arrive in `inputs` as full lists. The generated function must handle or reduce those lists and must not reject an input merely because it is not a string.'
        : 'Batch mode is `per_item`: each multi input port is expanded before `run(inputs)` is called, so one scalar item from each multi port is passed per invocation.';
      const formatContext = outputFormatContext(node.config);
      const dataContext = connectedDataContext();
      const generationContext = [batchContext, formatContext, dataContext].filter(Boolean).join('\n');
      const result = await generateCode({
        description: prompt,
        language: node.config.language,
        context: generationContext,
        context_file: node.config.config_context_file,
        inputs: inputNames,
        outputs: outputNames,
        ...genAI(),
      });
      setConfig('code', result.code);
      setGenMessage('✅ Code generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleGeneratePrompt = async () => {
    if (!node.description) {
      setGenMessage('Please add a description first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating system prompt…');
    try {
      const result = await generatePrompt({
        description: node.description,
        context: [outputFormatContext(node.config), connectedDataContext()].filter(Boolean).join('\n'),
        context_file: node.config.config_context_file,
        ...genAI(),
      });
      setConfig('system_prompt', result.system_prompt);
      setGenMessage('✅ Prompt generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateDataFormat = async () => {
    const prompt = node.config.data_prompt?.trim();
    if (!prompt) {
      setGenMessage('Please describe the data format first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating data format…');
    try {
      const result = await generateDataFormat({
        description: prompt,
        context: `Standard format family: ${node.config.data_format}.\n${connectedDataContext()}`,
        context_file: node.config.config_context_file,
        ...genAI(),
      });
      setConfig('data_format_prompt', result.output_format_prompt);
      setGenMessage('✅ Data format generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
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

  const handleGenerateSelectorCode = async () => {
    const selectorPrompt = (node.config.selector_prompt ?? '').trim();
    if (!selectorPrompt) {
      setGenMessage('Please describe which files to select first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating file selector…');
    try {
      const result = await generateCode({
        description: selectorPrompt,
        language: node.config.language || 'python',
        context: '`inputs["files"]` is the full list of rooted file paths found in the directory. Return only the selected paths as {"files": [...]}.',
        context_file: node.config.config_context_file,
        inputs: ['files'],
        outputs: ['files'],
        ...genAI(),
      });
      setConfig('selector_code', result.code);
      setGenMessage('✅ Selector generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col"
        style={{ background: '#1a1d2e', border: '1px solid #2d3148', maxHeight: '90vh' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ background: '#0f1117', borderBottom: '1px solid #2d3148' }}
        >
          <div className="flex items-center gap-3">
            <input
              className="text-lg font-bold bg-transparent border-none outline-none"
              style={{ color: '#e2e8f0' }}
              value={node.label}
              onChange={(e) => setNode((prev) => prev ? { ...prev, label: e.target.value } : prev)}
            />
          </div>
          <button onClick={onClose} style={{ color: '#94a3b8' }} className="hover:text-white text-xl">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b" style={{ borderColor: '#2d3148' }}>
          {tabs.map((tab) => (
            <button
              key={tab}
              className="px-5 py-3 text-sm capitalize transition-colors"
              style={{
                color: effectiveTab === tab ? '#6366f1' : '#94a3b8',
                borderBottom: effectiveTab === tab ? '2px solid #6366f1' : '2px solid transparent',
                background: 'transparent',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {node.node_type !== 'code' && node.node_type !== 'ai' && node.node_type !== 'data' && (
            <div className="mb-4">
              <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 64 }}
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
                <div className="text-sm px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc' }}>
                  {genMessage}
                </div>
              )}
            </div>
          )}

          {effectiveTab === 'output' && (
            showWidgetOutputTab
              ? <WidgetOutputSummary node={node} />
              : <OutputFormatEditor node={node} setConfig={setConfig} />
          )}

          {effectiveTab === 'preview' && (
            <div>
              <pre
                className="text-xs rounded-lg p-4 overflow-auto"
                style={{ background: '#0f1117', color: '#94a3b8', border: '1px solid #2d3148', maxHeight: 400 }}
              >
                {JSON.stringify(node, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ background: '#0f1117', borderTop: '1px solid #2d3148' }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg"
            style={{ background: '#2d3148', color: '#e2e8f0' }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 text-sm rounded-lg font-semibold"
            style={{ background: '#6366f1', color: 'white' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
