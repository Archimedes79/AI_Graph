import React from 'react';
import type { GraphNode } from '../../types/graph';
import type { AIProvider } from '../../types/graph';
import ProviderModelSelect from '../shared/ProviderModelSelect';
import ContextFileAttachment from '../shared/ContextFileAttachment';

interface CodeEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generating: boolean;
  handleGenerateCode: () => void;
  genProvider: AIProvider;
  genModel: string;
  onGenProviderChange: (provider: AIProvider) => void;
  onGenModelChange: (model: string) => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function CodeEditor({
  node,
  setConfig,
  generating,
  handleGenerateCode,
  genProvider,
  genModel,
  onGenProviderChange,
  onGenModelChange,
  contextFile,
  onContextFileChange,
}: CodeEditorProps) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
            Prompt text
          </label>
          <button
            onClick={handleGenerateCode}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#22c55e', color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 120 }}
          value={node.config.code_prompt}
          onChange={(e) => setConfig('code_prompt', e.target.value)}
          placeholder="Describe what the generated code should do."
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Provider selection
        </label>
        <ProviderModelSelect
          provider={genProvider}
          model={genModel}
          onProviderChange={onGenProviderChange}
          onModelChange={onGenModelChange}
        />
      </div>

      <ContextFileAttachment
        label="Additional data (optional context file)"
        path={contextFile}
        onChange={onContextFileChange}
      />

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>Language selection</label>
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

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Code window (editable)
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 220 }}
          value={node.config.code}
          onChange={(e) => setConfig('code', e.target.value)}
          placeholder={`def run(inputs):\n    return {"output": inputs.get("input", "")}`}
          spellCheck={false}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
          <input
            type="checkbox"
            checked={node.config.batch_mode === 'whole_list'}
            onChange={(e) => setConfig('batch_mode', e.target.checked ? 'whole_list' : 'per_item')}
          />
          Run once on the whole input array
        </label>
        <p className="text-xs mt-1" style={{ color: '#475569' }}>
          Leave unchecked to run this code separately for each item in a list input (default). Check this to receive the entire array at once — useful for totals, summaries, or merges.
        </p>
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
