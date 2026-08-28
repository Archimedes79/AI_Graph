import React from 'react';
import type { GraphNode } from '../../types/graph';
import type { AIProvider } from '../../types/graph';
import ProviderModelSelect from '../shared/ProviderModelSelect';
import ContextFileAttachment from '../shared/ContextFileAttachment';
import BatchAndFileInputOptions from '../shared/BatchAndFileInputOptions';
import { DIMMER, FIELD, MUTED, PRIMARY_BUTTON } from '../../ui/theme';

interface AIEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  setDescription: (value: string) => void;
  generating: boolean;
  onGenerate: () => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function AIEditor({
  node,
  setConfig,
  setDescription,
  generating,
  onGenerate,
  contextFile,
  onContextFileChange,
}: AIEditorProps) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          What this node should do
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none"
          style={{ ...FIELD, minHeight: 96 }}
          value={node.description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this node should do — ✨ Generate turns it into the system prompt below."
        />
      </div>

      <ContextFileAttachment
        label="Additional data (optional context file)"
        path={contextFile}
        onChange={onContextFileChange}
      />

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium" style={{ color: MUTED }}>
            System prompt
          </label>
          <button
            onClick={onGenerate}
            disabled={generating}
            className="text-xs px-2 py-1 rounded"
            style={{ ...PRIMARY_BUTTON, opacity: generating ? 0.5 : 1 }}
          >
            {generating ? '…' : '✨ Generate'}
          </button>
        </div>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm resize-none font-mono"
          style={{ ...FIELD, minHeight: 120 }}
          value={node.config.system_prompt}
          onChange={(e) => setConfig('system_prompt', e.target.value)}
          placeholder="You are a helpful assistant…"
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Runtime provider/model (used when this node runs)
        </label>
        <ProviderModelSelect
          provider={node.config.ai_provider}
          model={node.config.ai_model}
          onProviderChange={(p) => setConfig('ai_provider', p)}
          onModelChange={(m) => setConfig('ai_model', m)}
          allowDefault
          defaultLabel="Use the graph's default (⚙ Settings)"
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Leave this on the graph's default unless this one node must always use a specific
          provider — then a deployed copy of the graph can be pointed at a different AI
          without editing every node.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
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
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={!!node.config.send_images}
            onChange={(e) => setConfig('send_images', e.target.checked)}
          />
          Send image inputs as images (vision)
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          An input that is an image file is sent to the model as a picture instead of as a path
          in the prompt. Needs a model that can see — LM Studio serving a vision model works,
          as do the hosted ones. Leave &ldquo;Read file contents from paths&rdquo; off for those
          inputs: that turns the file into base64 text inside the prompt, which a vision model
          cannot use.
        </p>
      </div>

      <BatchAndFileInputOptions node={node} setConfig={setConfig} subject="prompt" />
    </>
  );
}

