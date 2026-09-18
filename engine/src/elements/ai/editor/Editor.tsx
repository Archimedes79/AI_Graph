import { useRef } from 'react';
import type { AIProvider, GraphNode } from '@/types/graph';
import AuthoredBodyEditor from '@/elements/shared/AuthoredBodyEditor';
import BatchAndFileInputOptions from '@/elements/shared/BatchAndFileInputOptions';
import ProviderModelSelect from '@/elements/shared/ProviderModelSelect';
import type { ElementGeneration, FieldAccess } from '@/elements/shared/generation';
import { ACCENT_FILL, ACCENT_TEXT, DIMMER, FIELD, MUTED } from '@/ui/theme';
import PromptPreview from './PromptPreview';

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

/**
 * What someone writes for an ai node, in the order the request is built:
 * what it should do, the instructions that became, the message its inputs are
 * laid out in -- and then the request itself, as the model will read it.
 *
 * Everything that is a knob rather than a sentence lives in `AIAdvanced`,
 * folded away below: a node works without anyone opening it.
 */
export default function AIEditor({
  node, setConfig, generation, fields, generating, message, onGenerate,
  contextFile, onContextFileChange,
}: AIEditorProps) {
  const template = useRef<HTMLTextAreaElement | null>(null);

  /** Put `{{port}}` where the cursor is, the way clicking a field name should. */
  const place = (portId: string) => {
    const box = template.current;
    const current = String(node.config.prompt_template ?? '');
    const token = `{{${portId}}}`;
    const at = box ? box.selectionStart : current.length;
    const end = box ? box.selectionEnd : current.length;
    setConfig('prompt_template', current.slice(0, at) + token + current.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(at + token.length, at + token.length);
    });
  };

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
        title={node.label}
      />

      <div>
        <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
          <label className="text-xs font-medium" style={{ color: MUTED }}>
            Message <span style={{ color: DIMMER }}>— how the inputs are laid out. Empty: they are sent as they arrive.</span>
          </label>
          <div className="flex items-center gap-1 flex-wrap">
            {node.inputs.map((port) => (
              <button
                key={port.id}
                onClick={() => place(port.id)}
                className="text-xs px-1.5 py-0.5 rounded font-mono"
                style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}
                title={`Place the value of "${port.name || port.id}" here`}
              >
                {`{{${port.id}}}`}
              </button>
            ))}
          </div>
        </div>
        <textarea
          ref={template}
          className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-y"
          style={{ ...FIELD, minHeight: 96 }}
          value={String(node.config.prompt_template ?? '')}
          onChange={(e) => setConfig('prompt_template', e.target.value)}
          placeholder={'Conversation so far:\n{{history}}\n\nUser: {{message}}'}
          spellCheck={false}
        />
      </div>

      <PromptPreview node={node} setConfig={setConfig} />
    </>
  );
}

/**
 * The knobs: which model, how freely, pictures or not, one call or one per
 * item, which tools. Every one of them has a default that is right for most
 * nodes, which is the reason they are folded away -- eleven controls in a row
 * made a node look like it needed eleven decisions before it would run.
 */
export function AIAdvanced({ node, setConfig }: Pick<AIEditorProps, 'node' | 'setConfig'>) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Model for this node
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
          Temperature ({node.config.temperature}) <span style={{ color: DIMMER }}>— low repeats itself, high surprises</span>
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
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Tools the model may use <span style={{ color: DIMMER }}>— MCP servers, one per line</span>
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm font-mono resize-y"
          style={{ ...FIELD, minHeight: 44 }}
          value={String(node.config.mcp_servers ?? '')}
          onChange={(e) => setConfig('mcp_servers', e.target.value)}
          placeholder={'https://example.com/mcp\nfilesystem'}
          spellCheck={false}
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          A URL is called directly. A name — <code>filesystem</code> — is looked up under{' '}
          <code>mcp_servers</code> in this machine's <code>ai-settings.json</code>, which is the only
          place a command line can come from: a graph someone hands you can ask for a tool by
          name, but it cannot start a program. While answering, the model calls the tools it
          needs; what it says afterwards is this node's output.
        </p>
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
          in the prompt. Needs a model that can see. Leave &ldquo;Read file contents from paths&rdquo;
          off for those inputs.
        </p>
      </div>

      <BatchAndFileInputOptions node={node} setConfig={setConfig} subject="prompt" />
    </>
  );
}
