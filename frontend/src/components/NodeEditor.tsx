import React, { useState, useEffect } from 'react';
import type { GraphNode, NodeType, AIProvider } from '../types/graph';
import { useGraphStore } from '../store/graphStore';
import { generateCode, generatePrompt } from '../utils/api';

interface NodeEditorProps {
  nodeId: string;
  onClose: () => void;
}

export default function NodeEditor({ nodeId, onClose }: NodeEditorProps) {
  const rfNode = useGraphStore((s) => s.rfNodes.find((n) => n.id === nodeId));
  const updateNode = useGraphStore((s) => s.updateNode);

  const [node, setNode] = useState<GraphNode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMessage, setGenMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'config' | 'ports' | 'preview'>('config');

  useEffect(() => {
    if (rfNode) {
      setNode(JSON.parse(JSON.stringify(rfNode.data.graphNode)));
    }
  }, [rfNode]);

  if (!node) return null;

  const save = () => {
    updateNode(nodeId, node);
    onClose();
  };

  const setConfig = (key: string, value: unknown) => {
    setNode((prev) =>
      prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev
    );
  };

  const handleGenerateCode = async () => {
    if (!node.description) {
      setGenMessage('Please add a description first.');
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
      const result = await generateCode({
        description: node.description,
        language: node.config.language,
        context: batchContext,
        inputs: inputNames,
        outputs: outputNames,
        ai_model: node.config.ai_model,
        ai_provider: node.config.ai_provider,
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
        ai_model: node.config.ai_model,
        ai_provider: node.config.ai_provider,
      });
      setConfig('system_prompt', result.system_prompt);
      setGenMessage('✅ Prompt generated!');
    } catch (e: any) {
      setGenMessage(`❌ ${e?.response?.data?.detail ?? e?.message ?? 'Error'}`);
    } finally {
      setGenerating(false);
    }
  };

  const nt = node.node_type;
  const isInput = ['text_input', 'file_input', 'directory_input'].includes(nt);
  const isAI = nt === 'ai';
  const isCode = nt === 'code';

  const handleGenerateSelectorCode = async () => {
    if (!node.description) {
      setGenMessage('Please describe which files to select first.');
      return;
    }
    setGenerating(true);
    setGenMessage('Generating file selector…');
    try {
      const result = await generateCode({
        description: node.config.selector_prompt || node.description,
        language: 'python',
        context: '`inputs["files"]` is the full list of rooted file paths found in the directory. Return only the selected paths as {"files": [...]}.',
        inputs: ['files'],
        outputs: ['files'],
        ai_model: node.config.ai_model,
        ai_provider: node.config.ai_provider,
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
          {(['config', 'ports', 'preview'] as const).map((tab) => (
            <button
              key={tab}
              className="px-5 py-3 text-sm capitalize transition-colors"
              style={{
                color: activeTab === tab ? '#6366f1' : '#94a3b8',
                borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
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
          {/* Description – always visible */}
          <div className="mb-4">
            <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
              Description (used for AI code/prompt generation)
            </label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-sm resize-none"
              style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 64 }}
              value={node.description}
              onChange={(e) => setNode((prev) => prev ? { ...prev, description: e.target.value } : prev)}
              placeholder="Describe what this node does…"
            />
          </div>

          {activeTab === 'config' && (
            <div className="space-y-4">
              {/* Input nodes */}
              {isInput && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                    {nt === 'text_input' ? 'Default Text (shown in the run dialog)' : 'Default Path (shown in the run dialog)'}
                  </label>
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                    value={node.config.value ?? ''}
                    onChange={(e) => setConfig('value', e.target.value)}
                    placeholder={nt === 'text_input' ? 'Enter default text…' : '/path/to/file'}
                  />
                  <p className="text-xs mt-2" style={{ color: '#475569' }}>
                    Whenever the graph runs, a dialog asks the user for this value
                    (pre-filled with the default above) — in the editor, the CLI, and
                    deployed runs.
                  </p>
                  {nt === 'directory_input' && (
                    <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: '#94a3b8' }}>
                      <input
                        type="checkbox"
                        checked={!!node.config.extra?.recursive}
                        onChange={(e) =>
                          setConfig('extra', { ...node.config.extra, recursive: e.target.checked })
                        }
                      />
                      Recursive
                    </label>
                  )}

                  {nt === 'directory_input' && (
                    <div className="mt-2">
                      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                        File types (comma-separated, e.g. .md, .txt)
                      </label>
                      <input
                        className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={(node.config.extra?.extensions as string) ?? ''}
                        onChange={(e) =>
                          setConfig('extra', { ...node.config.extra, extensions: e.target.value })
                        }
                        placeholder="Leave empty for all file types"
                      />
                    </div>
                  )}

                  {nt === 'directory_input' && (
                    <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2d3148' }}>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                        AI file-selection prompt
                      </label>
                      <textarea
                        className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 80 }}
                        value={node.config.selector_prompt}
                        onChange={(e) => setConfig('selector_prompt', e.target.value)}
                        placeholder="Select Markdown files that contain API documentation"
                      />
                      <label className="flex items-center gap-2 text-sm mb-2" style={{ color: '#94a3b8' }}>
                        <input
                          type="checkbox"
                          checked={node.config.select_all_files}
                          onChange={(e) => setConfig('select_all_files', e.target.checked)}
                        />
                        Select all files
                      </label>
                      {!node.config.select_all_files && (
                        <>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                              File Selector Code — run(inputs) receives {'{'}"files"{'}'} and must return {'{'}"files"{'}'}
                            </label>
                            <button
                              onClick={handleGenerateSelectorCode}
                              disabled={generating}
                              className="text-xs px-2 py-1 rounded"
                              style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
                            >
                              {generating ? '…' : '✨ Generate'}
                            </button>
                          </div>
                          <textarea
                            className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                            style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 140 }}
                            value={node.config.selector_code}
                            onChange={(e) => setConfig('selector_code', e.target.value)}
                            spellCheck={false}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* AI node */}
              {isAI && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                        Provider
                      </label>
                      <select
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.ai_provider}
                        onChange={(e) => setConfig('ai_provider', e.target.value as AIProvider)}
                      >
                        <option value="ollama">Ollama (local)</option>
                        <option value="lmstudio">LM Studio (local)</option>
                        <option value="openai">OpenAI</option>
                        <option value="openai_compatible">OpenAI-compatible endpoint</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                        Model
                      </label>
                      <input
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.ai_model}
                        onChange={(e) => setConfig('ai_model', e.target.value)}
                        placeholder="llama3"
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                        System Prompt
                      </label>
                      <button
                        onClick={handleGeneratePrompt}
                        disabled={generating}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: '#6366f1', color: 'white', opacity: generating ? 0.5 : 1 }}
                      >
                        {generating ? '…' : '✨ Generate from description'}
                      </button>
                    </div>
                    <textarea
                      className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                      style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 120 }}
                      value={node.config.system_prompt}
                      onChange={(e) => setConfig('system_prompt', e.target.value)}
                      placeholder="You are a helpful assistant…"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                      Temperature ({node.config.temperature})
                    </label>
                    <input
                      type="range"
                      min={0} max={2} step={0.05}
                      value={node.config.temperature}
                      onChange={(e) => setConfig('temperature', parseFloat(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                      Batch mode
                    </label>
                    <select
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                      value={node.config.batch_mode}
                      onChange={(e) => setConfig('batch_mode', e.target.value)}
                    >
                      <option value="per_item">Per item (default)</option>
                      <option value="whole_list">Whole list at once (for totals/summaries)</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
                      <input
                        type="checkbox"
                        checked={!!node.config.read_file_inputs}
                        onChange={(e) => setConfig('read_file_inputs', e.target.checked)}
                      />
                      Read file contents from paths
                    </label>
                    <p className="text-xs mt-1" style={{ color: '#475569' }}>
                      When enabled, any input port with data type 'File path' is automatically read from disk (text or base64) before this node runs.
                    </p>
                  </div>
                </>
              )}

              {/* Code node */}
              {isCode && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-3">
                      <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
                        Language
                      </label>
                      <select
                        className="rounded px-2 py-1 text-sm"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.language}
                        onChange={(e) => setConfig('language', e.target.value)}
                      >
                        <option value="python">Python</option>
                        <option value="javascript">JavaScript</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded px-2 py-1 text-xs"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.ai_provider}
                        onChange={(e) => setConfig('ai_provider', e.target.value)}
                      >
                        <option value="ollama">Ollama</option>
                        <option value="lmstudio">LM Studio</option>
                        <option value="openai">OpenAI</option>
                        <option value="openai_compatible">OpenAI-compatible endpoint</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                      <input
                        className="rounded px-2 py-1 text-xs w-24"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.ai_model}
                        onChange={(e) => setConfig('ai_model', e.target.value)}
                        placeholder="llama3"
                      />
                      <button
                        onClick={handleGenerateCode}
                        disabled={generating}
                        className="text-xs px-2 py-1 rounded"
                        style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
                      >
                        {generating ? '…' : '✨ Generate'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 200 }}
                    value={node.config.code}
                    onChange={(e) => setConfig('code', e.target.value)}
                    placeholder={`def run(inputs):\n    return {"output": inputs.get("input", "")}`}
                    spellCheck={false}
                  />
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                      Batch mode
                    </label>
                    <select
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                      value={node.config.batch_mode}
                      onChange={(e) => setConfig('batch_mode', e.target.value)}
                    >
                      <option value="per_item">Per item (default)</option>
                      <option value="whole_list">Whole list at once (for totals/summaries)</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
                      <input
                        type="checkbox"
                        checked={!!node.config.read_file_inputs}
                        onChange={(e) => setConfig('read_file_inputs', e.target.checked)}
                      />
                      Read file contents from paths
                    </label>
                    <p className="text-xs mt-1" style={{ color: '#475569' }}>
                      When enabled, any input port with data type 'File path' is automatically read from disk (text or base64) before this node runs.
                    </p>
                  </div>
                </>
              )}

              {/* Output node */}
              {nt === 'output' && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                    Output Label
                  </label>
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                    value={node.config.output_label}
                    onChange={(e) => setConfig('output_label', e.target.value)}
                  />

                  <div className="mt-4 pt-4" style={{ borderTop: '1px solid #2d3148' }}>
                    <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                      Write result to disk
                    </label>
                    <select
                      className="w-full rounded-lg px-3 py-2 text-sm"
                      style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                      value={node.config.write_mode}
                      onChange={(e) => setConfig('write_mode', e.target.value)}
                    >
                      <option value="none">Don't write to disk (show in Results panel only)</option>
                      <option value="file">Write to a single file</option>
                      <option value="directory">Write to a directory (one file per value)</option>
                    </select>

                    {node.config.write_mode !== 'none' && (
                      <>
                        <label className="block text-xs font-medium mb-1 mt-3" style={{ color: '#94a3b8' }}>
                          {node.config.write_mode === 'file' ? 'Output file path' : 'Output directory path'}
                        </label>
                        <input
                          className="w-full rounded-lg px-3 py-2 text-sm"
                          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                          value={node.config.value ?? ''}
                          onChange={(e) => setConfig('value', e.target.value)}
                          placeholder={node.config.write_mode === 'file' ? '/path/to/output.txt' : '/path/to/output-dir'}
                          disabled={node.config.prompt_at_runtime}
                        />
                        <label className="flex items-center gap-2 mt-2 text-sm" style={{ color: '#94a3b8' }}>
                          <input
                            type="checkbox"
                            checked={!!node.config.prompt_at_runtime}
                            onChange={(e) => setConfig('prompt_at_runtime', e.target.checked)}
                          />
                          Ask for path when running (web, CLI, and deployed runs)
                        </label>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Text Output node */}
              {nt === 'text_output' && (
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                    Window Title
                  </label>
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm"
                    style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                    value={node.config.output_label}
                    onChange={(e) => setConfig('output_label', e.target.value)}
                  />
                  <p className="text-xs mt-2" style={{ color: '#475569' }}>
                    When the graph runs, the connected value is shown to the user in its own text
                    window (in the editor, printed to the console for CLI runs, and for deployed
                    runs).
                  </p>
                </div>
              )}

              {/* Merge/Split */}
              {(nt === 'merge' || nt === 'split') && (
                <div>
                  {nt === 'merge' && (
                    <div className="mb-3">
                      <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                        Merge mode
                      </label>
                      <select
                        className="w-full rounded-lg px-3 py-2 text-sm"
                        style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }}
                        value={node.config.merge_mode}
                        onChange={(e) => setConfig('merge_mode', e.target.value)}
                      >
                        <option value="concat">Concatenate text (default)</option>
                        <option value="sum">Sum numbers</option>
                        <option value="count">Count values</option>
                        <option value="json_list">JSON list</option>
                      </select>
                    </div>
                  )}
                  <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
                    Separator
                  </label>
                  <input
                    className="w-full rounded-lg px-3 py-2 text-sm font-mono"
                    style={
                      nt === 'merge' && node.config.merge_mode !== 'concat'
                        ? { background: '#0f1117', color: '#475569', border: '1px solid #2d3148', opacity: 0.5 }
                        : { background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148' }
                    }
                    value={node.config.separator}
                    onChange={(e) => setConfig('separator', e.target.value)}
                    placeholder="\n"
                    disabled={nt === 'merge' && node.config.merge_mode !== 'concat'}
                  />
                  {nt === 'merge' && node.config.merge_mode !== 'concat' && (
                    <p className="text-xs mt-1" style={{ color: '#475569' }}>
                      Separator is unused in this merge mode.
                    </p>
                  )}
                </div>
              )}

              {genMessage && (
                <div className="text-sm px-3 py-2 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc' }}>
                  {genMessage}
                </div>
              )}
            </div>
          )}

          {activeTab === 'ports' && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: '#94a3b8' }}>
                Port definitions are set automatically based on node type. You can review them here.
              </p>
              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: '#e2e8f0' }}>
                  Inputs
                </h3>
                {node.inputs.length === 0 && <p className="text-xs" style={{ color: '#475569' }}>No input ports</p>}
                {node.inputs.map((port) => (
                  <div key={port.id} className="mb-2 px-3 py-2 rounded-lg flex items-center gap-3" style={{ background: '#0f1117', border: '1px solid #2d3148' }}>
                    <span className="text-xs font-mono" style={{ color: '#6366f1' }}>{port.id}</span>
                    <span className="text-xs" style={{ color: '#e2e8f0' }}>{port.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#93c5fd' }}>{port.data_type}</span>
                    {port.multi && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>multi</span>}
                    {port.required && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#3a2000', color: '#fdba74' }}>required</span>}
                  </div>
                ))}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2" style={{ color: '#e2e8f0' }}>
                  Outputs
                </h3>
                {node.outputs.length === 0 && <p className="text-xs" style={{ color: '#475569' }}>No output ports</p>}
                {node.outputs.map((port) => (
                  <div key={port.id} className="mb-2 px-3 py-2 rounded-lg flex items-center gap-3" style={{ background: '#0f1117', border: '1px solid #2d3148' }}>
                    <span className="text-xs font-mono" style={{ color: '#22c55e' }}>{port.id}</span>
                    <span className="text-xs" style={{ color: '#e2e8f0' }}>{port.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#1a3a2a', color: '#86efac' }}>{port.data_type}</span>
                    {port.multi && <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c4b5fd' }}>multi</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'preview' && (
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
