import type { GraphNode } from '@/graph';
import { useGraphStore } from '@/store/graphStore';
import { lastRunInputs } from '@/authoring/generationContext';
import NodeTryIt from '@/authoring/NodeTryIt';
import { clip } from '@/authoring/TryItPanel';
import { tryValues, useTryValues } from '@/authoring/tryValues';
import { DANGER_TEXT, DIM, DIMMER, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';
import { AiNode } from '@engine/elements/nodes/ai/AiNode.ts';
import { assemblePrompt, promptText } from '@engine/elements/nodes/ai/prompt.ts';

const ai = new AiNode();

/**
 * The request this node sends, as the model will read it -- inside the panel
 * every element is tried out in.
 *
 * Built by the engine's own `assemblePrompt`, from the node as it stands in
 * the dialog right now, so what is shown is what a run does. The values are the
 * panel's: the last run's, the graph's, or a sentence typed for the purpose.
 *
 * It is also the honest answer to "do I have to describe the output format?":
 * no -- run it once, look at what came back, and if that is the shape you want,
 * keep it as the example the model is told to follow.
 */
export default function PromptPreview({ node, setConfig }: {
  node: GraphNode;
  setConfig: (key: string, value: unknown) => void;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const typed = useTryValues((state) => state.typed[node.id]);
  const fetched = useTryValues((state) => state.fetched[node.id]);
  const { values } = tryValues(node.id, node.inputs.map((port) => port.id), lastRunInputs(node.id, executionResult) ?? {}, {
    typed: { [node.id]: typed ?? {} }, fetched: { [node.id]: fetched ?? {} },
  });

  const wired = new Set(rfEdges.filter((edge) => edge.target === node.id).map((edge) => edge.targetHandle));
  const settings = ai.config(node as never);
  // A port with no value yet is shown by name -- but only one that is wired:
  // an unconnected port sends nothing, and a preview that put a placeholder
  // there would be showing a request the run never makes.
  const shown = assemblePrompt(settings, Object.fromEntries(
    node.inputs
      .filter((port) => values[port.id] !== undefined || wired.has(port.id))
      .map((port) => [port.id, values[port.id] ?? `⟨${port.name || port.id}⟩`]),
  ));

  return (
    <NodeTryIt
      node={node}
      title="What the model receives"
      renderResult={(result) => {
        const answer = promptText(result.outputs?.output);
        return (
          <div className="mt-1">
            <pre className="text-xs rounded px-2 py-1.5 whitespace-pre-wrap overflow-auto" style={{ background: SUNKEN, color: TEXT, maxHeight: 220 }}>
              {answer}
            </pre>
            {answer && (
              <button
                className="text-xs px-2 py-0.5 rounded mt-1"
                style={NEUTRAL_BUTTON}
                onClick={() => { setConfig('output_example', answer); setConfig('output_format', 'example'); }}
                title="Tell the model to answer in this same shape from now on"
              >
                Keep this as the format to follow
              </button>
            )}
          </div>
        );
      }}
    >
      <Part label="Instructions" hint="system" text={shown.system} empty="(none — the model gets the message alone)" />
      <Part label="Message" hint="user" text={shown.user} empty="(nothing is wired in yet)" />

      {shown.unknown.length > 0 && (
        <p className="text-xs" style={{ color: DANGER_TEXT }}>
          Nothing is wired to {shown.unknown.map((name) => `{{${name}}}`).join(', ')} — it is sent as nothing.
          This node's inputs are: {node.inputs.map((port) => port.id).join(', ') || 'none'}.
        </p>
      )}
      {shown.appended.length > 0 && settings.template.trim() && (
        <p className="text-xs" style={{ color: DIM }}>
          {shown.appended.map((name) => `{{${name}}}`).join(', ')} is wired in but not placed, so it is sent
          after the message. Nothing wired in is ever left out.
        </p>
      )}
    </NodeTryIt>
  );
}

function Part({ label, hint, text, empty }: { label: string; hint: string; text: string; empty: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-0.5">
        <span className="text-xs font-medium" style={{ color: MUTED }}>{label}</span>
        <span className="text-xs" style={{ color: DIMMER }}>{hint}</span>
      </div>
      <pre
        className="text-xs rounded px-2 py-1.5 whitespace-pre-wrap overflow-auto"
        style={{ background: SUNKEN, color: text ? TEXT : DIMMER, maxHeight: 180 }}
      >
        {text ? clip(text, 1200) : empty}
      </pre>
    </div>
  );
}
