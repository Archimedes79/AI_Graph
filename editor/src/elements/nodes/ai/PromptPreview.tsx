import { useState } from 'react';
import type { Graph, GraphNode } from '@/graph';
import { call } from '@/api/client';
import { errorText } from '@/api/errorText';
import type { SentRequest } from '@engine/host/api.ts';
import { useGraphStore } from '@/store/graphStore';
import { readFilePorts } from '@/authoring/generationContext';
import { runsPerItem } from '@/authoring/nodeStepRules';
import { clip } from '@/authoring/TryItInline';
import { DANGER_TEXT, DIM, DIMMER, MUTED, NEUTRAL_BUTTON, SUNKEN, TEXT } from '@/ui/theme';
import { AiNodeRunner } from '@engine/elements/nodes/ai/AiNodeRunner.ts';
import { assemblePrompt } from '@engine/elements/nodes/ai/prompt.ts';

const ai = new AiNodeRunner();

/**
 * Whether the request for the *example* can be put together here, as it is:
 * only when a run would send exactly `assemblePrompt` of it. Not when a file
 * on a port is read into its text first, not when a list is asked about one
 * item at a time, not when pictures are split off, and not when a run.js of
 * the person's own decides what to ask -- then the engine is asked, by running
 * the node with made-up answers, and it shows each request a run would send.
 * A port the example has no value for is not read and not fanned out.
 */
export function previewIsLocal(node: GraphNode, example: Record<string, unknown>, reads: string[]): boolean {
  const settings = ai.config(node as never);
  if (settings.runCode || settings.sendImages) return false;
  if (reads.some((port) => example[port] !== undefined)) return false;
  const fansOut = runsPerItem(node) && node.inputs.some((port) => port.multi && Array.isArray(example[port.id]));
  return !fansOut;
}

/**
 * What the model receives, for the example in step 1: the instructions, and
 * the message its inputs are laid out in.
 *
 * Put together here with the engine's own `assemblePrompt` when that is all a
 * run does; otherwise asked of the engine, which runs the node the way a run
 * does -- files read, once per item, pictures split off -- with made-up
 * answers and nothing sent to a model. It was always put together here, and
 * then said "exactly what the model will receive" over a path where the model
 * gets the file's text, and over all the stories joined where it gets one.
 */
export default function PromptPreview({ node, example, graph }: {
  node: GraphNode;
  example: Record<string, unknown> | undefined;
  /** The graph with this node as the dialog holds it (`NodePanelProps.steps.graph`). */
  graph: () => Graph;
}) {
  const edges = useGraphStore((s) => s.rfEdges);

  const wired = new Set(edges.filter((edge) => edge.target === node.id).map((edge) => edge.targetHandle));
  const settings = ai.config(node as never);
  // A port with no value in the example is shown by name -- but only one that
  // is wired: an unconnected port sends nothing, and a preview that put a
  // placeholder there would be showing a request the run never makes.
  const values = example ?? {};
  const given = Object.fromEntries(
    node.inputs
      .filter((port) => values[port.id] !== undefined || wired.has(port.id))
      .map((port) => [port.id, values[port.id] ?? `⟨${port.name || port.id}⟩`]),
  );

  if (!previewIsLocal(node, values, readFilePorts(node))) {
    // Only the example's own values: a placeholder must not be read as a file name.
    return <EngineRequests node={node} inputs={values} own={!!settings.runCode} graph={graph} />;
  }
  const shown = assemblePrompt(settings, given);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium" style={{ color: MUTED }}>What the model receives, for the example in step 1</p>
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
    </div>
  );
}

/**
 * What a run asks, found by running the node -- its own run.js, or the
 * engine's -- with made-up answers: its questions cannot be assembled here.
 */
function EngineRequests({ node, inputs, own, graph }: {
  node: GraphNode; inputs: Record<string, unknown>; own: boolean; graph: () => Graph;
}) {
  const [asked, setAsked] = useState<{ requests: SentRequest[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async () => {
    setBusy(true);
    try {
      setAsked(await call('nodeRequests', { ...graph(), node_id: node.id, inputs }));
    } catch (error) {
      setAsked({ requests: [], error: errorText(error, 'It could not be run.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON} onClick={show} disabled={busy}
          title="Run this node on the example with made-up answers, and show each request it sends. Nothing is sent to a model.">
          {busy ? '…' : asked ? 'Show again' : 'Show what the model receives'}
        </button>
        <span className="text-xs" style={{ color: DIMMER }}>
          {own
            ? 'run.js is yours: what it asks is found by running it, with made-up answers.'
            : 'Files are read, and a list is asked about one item at a time: found by running it, with made-up answers.'}
        </span>
      </div>
      {asked?.error && <p className="text-xs" style={{ color: DANGER_TEXT }}>{asked.error}</p>}
      {asked && !asked.error && !asked.requests.length && <p className="text-xs" style={{ color: DIM }}>It asked the model nothing.</p>}
      {asked?.requests.map((request, index) => (
        <div key={index} className="space-y-1">
          {asked.requests.length > 1 && <p className="text-xs font-medium" style={{ color: MUTED }}>Request {index + 1} of {asked.requests.length}</p>}
          <Part label="Instructions" hint="system" text={request.system} empty="(none)" />
          <Part label="Message" hint={request.images ? `user, with ${request.images} image${request.images > 1 ? 's' : ''}` : 'user'} text={request.prompt} empty="(empty)" />
        </div>
      ))}
    </div>
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
