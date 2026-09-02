import React from 'react';
import type { AIProvider, GraphNode } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import BatchAndFileInputOptions from '@/elements/shared/BatchAndFileInputOptions';
import ProviderModelSelect from '@/elements/shared/ProviderModelSelect';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { DIMMER, MUTED } from '@/ui/theme';

interface AIEditorProps {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
  generation: ElementGeneration<GraphNode>;
  fields: FieldAccess;
  generating: boolean;
  message?: string;
  onGenerate: () => void;
  contextFile: string;
  onContextFileChange: (path: string) => void;
}

export default function AIEditor({
  node, setConfig, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange,
}: AIEditorProps) {
  return (
    <>
      <AuthoredBodyEditor
        generation={generation}
        fields={fields}
        exampleFile={contextFile}
        onExampleFileChange={onContextFileChange}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
      />

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Runtime provider/model (used when this node runs)
        </label>
        <ProviderModelSelect
          provider={node.config.ai_provider as AIProvider}
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
