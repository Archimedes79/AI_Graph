import type { AIProvider } from '@/graph';
import BatchAndFileInputOptions from '../../fields/BatchAndFileInputOptions';
import ProviderModelSelect from '../../fields/ProviderModelSelect';
import { DIMMER, FIELD, MUTED } from '@/ui/theme';
import type { NodeAdvancedPanelProps } from '../../Ui';

/**
 * The knobs: which model, how freely, pictures or not, one call or one per
 * item, which tools. Every one of them has a default that is right for most
 * nodes, which is the reason they are folded away -- eleven controls in a row
 * made a node look like it needed eleven decisions before it would run.
 */
export default function AiNodeAdvancedPanel({ node, setConfig }: NodeAdvancedPanelProps) {
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
