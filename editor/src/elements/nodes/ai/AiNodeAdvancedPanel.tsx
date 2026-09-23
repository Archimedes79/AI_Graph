import type { AIProvider } from '@/graph';
import BatchAndFileInputOptions from '../../fields/BatchAndFileInputOptions';
import ProviderModelSelect from '../../fields/ProviderModelSelect';
import { DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';
import CodeField from '@/authoring/CodeField';
import { AI_RUN, LLM_CALLS_PER_RUN, isStandardRun } from '@engine/elements/nodes/ai/runTemplate.ts';
import type { NodeAdvancedPanelProps } from '../../NodeGuiBuilder';

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

      <RunCode code={String(node.config.run_code ?? '')} onChange={(code) => setConfig('run_code', code)} />
    </>
  );
}

/**
 * `run.js`: what this node does when it runs, as the project folder keeps it.
 *
 * Shown whether or not anyone wrote it, because "how do these prompts reach the
 * model" is a question the folder should answer. Left as it is, it is the
 * engine's and follows the engine; changed, it is a body like a code node's --
 * sandboxed, without this machine's keys, asking for its calls.
 */
function RunCode({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  const own = !isStandardRun(code);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="block text-xs font-medium" style={{ color: MUTED }}>
          What this node runs <span style={{ color: DIMMER }}>— run.js{own ? ', changed by you' : ', the standard'}</span>
        </label>
        {own && (
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => onChange('')}>
            Back to the standard
          </button>
        )}
      </div>
      <CodeField value={own ? code : AI_RUN} onChange={onChange} language="javascript" minHeight={150} title="run.js" />
      <p className="text-xs mt-1" style={{ color: DIMMER }}>
        One call to the model, with <code>system.md</code> and <code>message.md</code>. Change it for a loop, a
        second call or a check of the answer: <code>await node.llm(&#123; prompt &#125;)</code> asks for a call, at
        most {LLM_CALLS_PER_RUN} times a run. Your version runs sandboxed and never sees this machine's keys.
        {own && ' "Try it" shows what your version asks, found by running it with made-up answers.'}
      </p>
    </div>
  );
}
