import React from 'react';
import type { GraphNode } from '../../types/graph';
import type { AIProvider } from '../../types/graph';
import ProviderModelSelect from '../shared/ProviderModelSelect';
import ContextFileAttachment from '../shared/ContextFileAttachment';

interface AIEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  setDescription: (value: string) => void;
  generating: boolean;
  handleGeneratePrompt: () => void;
  genProvider: AIProvider;
  genModel: string;
  onGenProviderChange: (provider: AIProvider) => void;
  onGenModelChange: (model: string) => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function AIEditor({
  node,
  setConfig,
  setDescription,
  generating,
  handleGeneratePrompt,
  genProvider,
  genModel,
  onGenProviderChange,
  onGenModelChange,
  contextFile,
  onContextFileChange,
}: AIEditorProps) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: '#94a3b8' }}>
          Text describing the prompt
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ background: '#0f1117', color: '#e2e8f0', border: '1px solid #2d3148', minHeight: 96 }}
          value={node.description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the assistant behavior you want in the runtime prompt."
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

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: '#94a3b8' }}>
            Runtime prompt window
          </label>
          <button
            onClick={handleGeneratePrompt}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ background: '#6366f1', color: 'white', opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
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
          Runtime provider/model (used when this node runs)
        </label>
        <ProviderModelSelect
          provider={node.config.ai_provider}
          model={node.config.ai_model}
          onProviderChange={(p) => setConfig('ai_provider', p)}
          onModelChange={(m) => setConfig('ai_model', m)}
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
        <label className="flex items-center gap-2 text-sm" style={{ color: '#94a3b8' }}>
          <input
            type="checkbox"
            checked={node.config.batch_mode === 'whole_list'}
            onChange={(e) => setConfig('batch_mode', e.target.checked ? 'whole_list' : 'per_item')}
          />
          Run once on the whole input array
        </label>
        <p className="text-xs mt-1" style={{ color: '#475569' }}>
          Leave unchecked to run this prompt separately for each item in a list input (default). Check this to receive the entire array at once — useful for totals, summaries, or merges.
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

