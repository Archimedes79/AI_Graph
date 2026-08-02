import React from 'react';
import type { GraphNode } from '../../../types/graph';

interface CodeEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateCode: () => void;
}

export default function CodeEditor({ node, setConfig, generating, handleGenerateCode }: CodeEditorProps) {
  return (
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
  );
}
