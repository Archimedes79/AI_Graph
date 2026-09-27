import { Suspense, useRef } from 'react';
import type { Port } from '@/graph';
import { shapeToKeep, useGraphStore } from '@/store/graphStore';
import { derivedNodePorts } from '@/document/guiWidgets';
import PortsEditor from './PortsEditor';
import { withPorts } from './nodeDraft';
import { useNodeDialog } from './nodeDialog';
import { NODE_BUILDERS } from '@/elements/registry';
import type { NodePanelProps, UndoStep } from '@/elements/NodeGuiBuilder';
import Modal from '@/ui/Modal';
import { useGenerate } from '@/authoring/useGenerate';
import { buildGeneration, nodeFields, withChange, type ChangeAsked, type GenerationRequest } from '@/authoring/generation';
import { useWhatSends } from '@/authoring/WhatSends';
import { inputSources, outputTargets } from '@/authoring/generationContext';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { nodeFacts } from '@/authoring/nodeFacts';
import { runsPerItem } from '@/authoring/nodeStepRules';
import { fromTheGraph } from '@/authoring/fromTheGraph';
import { nodeLogic } from '@/authoring/logic';
import { GenerationReport } from '@/authoring/GenerationTranscript';
import WhatRuns from '@/elements/fields/WhatRuns';
import OpenInMyEditor from '@/authoring/OpenInMyEditor';
import type { GraphNode } from '@/graph';
import { FIELD, LINE, MUTED, TEXT } from '@/ui/theme';

interface NodeEditorProps {
  nodeId: string;
  onClose: () => void;
}

/**
 * A node's dialog. There is no Save and no Cancel: what is changed here is in
 * the graph a moment later, Undo takes it back, and ✕ or Esc close it with
 * nothing lost (`nodeDialog.ts`).
 */
export default function NodeEditor({ nodeId, onClose }: NodeEditorProps) {
  const dialog = useNodeDialog(nodeId);
  const graphNodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const graphEdges = useGraphStore((s) => s.rfEdges);
  // The last run's per-node values: the best generation context available, and
  // it was sitting in the store unused.
  const executionResult = useGraphStore((s) => s.executionResult);

  // What ✨ Generate would send, when asked: shown, not sent. The request is
  // the one the button sends, built further down from the node as it is then.
  const generationRequest = useRef<() => GenerationRequest<GraphNode> | undefined>(() => undefined);
  const sends = useWhatSends(() => generationRequest.current(), nodeId);
  // One state machine for every ✨ Generate button in this editor.
  const generate = useGenerate();

  const node = dialog.node();
  if (!node) return null;

  // No tabs. There were two: Config, and a Preview that printed the node's own
  // JSON. Nobody edits a graph by reading its serialization -- it answered a
  // question ("what did that setting actually store?") that the file on disk
  // answers better, and it cost every node a tab bar to get to the one tab that
  // does something. What a node emits was a third tab for two of six types; it
  // is said in step 2 of the four steps now, in words (`OutputWordsField`).
  const element = NODE_BUILDERS[node.node_type];
  const caught = node.config.catch_errors === true;

  const setConfig: NodePanelProps['setConfig'] = (key, value, step) => dialog.setConfig(key, value, step);
  const setDescription = (value: string) => dialog.change((current) => ({ ...current, description: value }));

  /**
   * The one ✨ Generate handler.
   *
   * There were four here -- code, system prompt, data format, file selector --
   * and every Panel was handed all of them so it could use the one it
   * recognised. They differed only in the things `ElementGeneration` now names,
   * so the element declares them and this shell no longer knows which node type
   * it is looking at. Adding a generating node type adds nothing to this file.
   */
  const generation = element.generation;
  const fields = nodeFields(node, setConfig, setDescription);
  /** Everything ✨ Generate is told, in one request: the button and its preview send the same. */
  generationRequest.current = (): GenerationRequest<GraphNode> | undefined => generation && ({
      element: node.node_type,
      generation,
      subject: node,
      fields,
      // What the node says about itself -- ports, samples, wiring, format,
      // shape, examples -- as facts the engine writes one brief from.
      ...nodeFacts(node, graphNodes, graphEdges, executionResult),
      // Asked of the node as it is when the answer comes back.
      recordShape: (outputs) => {
        const current = dialog.node();
        const kept = current && shapeToKeep(current, outputs);
        if (kept) setConfig('output_schema', kept);
      },
    });
  const handleGenerate = async (change?: ChangeAsked): Promise<boolean> => {
    const request = generationRequest.current();
    if (!request) return false;
    const options = buildGeneration(withChange(request, change));
    // What ✨ wrote -- a body, and with a change the task beside it -- is one
    // undo step of its own, after what was typed before it, which is written
    // first as the step it was.
    return generate.run({ ...options, apply: (result) => { dialog.write(); options.apply(result); dialog.write(true); } });
  };

  const Panel = element.Panel;

  // What each port is wired to, in words, shown under the port -- and for an
  // output, what the node there wants of it: what the graph says it must be.
  const wiring = {
    inputs: inputSources(node.id, graphNodes, graphEdges),
    outputs: outputTargets(node.id, graphNodes, graphEdges, true),
  };
  const setPorts = (ports: { inputs: Port[]; outputs: Port[] }, step?: UndoStep) => dialog.change((current) => withPorts(current, ports), step);
  // The ports are the person's to name, rather than following a setting.
  const ownPorts = derivedNodePorts(node) === null;
  const stepped = element.stepped && ownPorts;
  const ports = (side: 'inputs' | 'outputs' | 'both') => (
    <PortsEditor
      inputs={node.inputs}
      outputs={node.outputs}
      onChange={setPorts}
      side={side}
      editing={element.portEditing}
      hints={{ inputs: element.portHint('inputs', node), outputs: element.portHint('outputs', node) }}
      wiring={wiring}
      readsFiles={engineRegistry.node(node.node_type)?.readsFileInputs ?? false}
      stepped={stepped}
      perItem={stepped && runsPerItem(node)}
      caught={caught}
    />
  );
  // What waits is written before the project is saved, so the file holds
  // what the dialog shows.
  const openInEditor = nodeLogic(node) ? <OpenInMyEditor nodeId={nodeId} before={() => dialog.write()} /> : undefined;
  // For an element that authors a body, what only this shell has, for the
  // panel to place in its four steps: the port lists inside "what comes in"
  // and "what comes out" where the ports are the person's, and "what ✨ sends"
  // and "open in my editor" beside the body.
  // And the graph with this node in it as the dialog shows it, read when
  // asked: what is tried and fetched from the graph is the edit as it is then.
  const graph = () => {
    const whole = useGraphStore.getState().exportGraph();
    const current = dialog.node() ?? node;
    whole.nodes = whole.nodes.map((candidate) => (candidate.id === current.id ? current : candidate));
    return whole;
  };
  const steps: NodePanelProps['steps'] = generation ? {
    ...(stepped ? { inputs: ports('inputs'), outputs: ports('outputs') } : {}),
    openInEditor,
    preview: sends.preview,
    sent: sends.sent,
    graph,
    fromGraph: node.inputs.length ? () => fromTheGraph(node.id, executionResult, graph) : undefined,
  } : undefined;

  return (
    <Modal
      title={
        <input
          className="text-lg font-bold bg-transparent border-none outline-none w-full"
          style={{ color: TEXT }}
          value={node.label}
          aria-label="Node label"
          onChange={(e) => {
            const label = e.target.value;
            dialog.change((current) => ({ ...current, label }));
          }}
        />
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
      scrollBody
      // A stray click beside it is not a reason to close it.
      dismissOnBackdrop={false}
    >
      <div className="px-6 py-5">
          {/* Only for elements whose own editor does not already ask what the
              node is for. An ai node's description IS its generation prompt, so
              drawing this above it showed the same box twice. */}
          {!element.ownsDescription && (
            <div className="mb-4">
              <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                style={{ ...FIELD, minHeight: 64 }}
                value={node.description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={element.hint}
              />
            </div>
          )}

          <GenerationReport calls={generate.transcript()} live={generate.liveTranscript()}>
          <div className="space-y-4">
              {/* A panel is its own chunk, loaded when a node is first opened. */}
              {Panel && <Suspense fallback={null}><Panel
                builder={element}
                node={node}
                setConfig={setConfig}
                updateNode={(change, step) => dialog.change(change, step)}
                fields={fields}
                generating={generate.busy}
                message={generate.message()}
                onGenerate={handleGenerate}
                steps={steps}
              /></Suspense>}

              {/* What this node takes in and hands out, where that is the
                  person's to say. A gui node's ports follow its blocks and an
                  input node's follow its mode, and the element is what knows
                  which -- so the question is asked, never switched on a type. */}
              {!stepped && ownPorts && (
                <details className="rounded-lg" open style={{ border: `1px solid ${LINE}` }}>
                  <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
                    {element.portEditing.outputs === 'none' ? 'Ports — what comes in' : 'Ports — what goes in and comes out'}
                  </summary>
                  <div className="px-3 pb-3 pt-1">
                    {ports('both')}
                  </div>
                </details>
              )}

              {/* Knobs with good defaults, folded away: a node should open on
                  what it does, not on a form to fill in first. */}
              {element.AdvancedPanel && (
                <details className="rounded-lg" style={{ border: `1px solid ${LINE}` }}>
                  <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
                    Advanced{element.advancedSummary ? ` — ${element.advancedSummary}` : ''}
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-4">
                    <Suspense fallback={null}>
                      <element.AdvancedPanel node={node} setConfig={setConfig} />
                    </Suspense>
                    <WhatRuns node={node} />
                  </div>
                </details>
              )}
              {/* Where the work is done, technically: for the curious, so folded. */}
              {!element.AdvancedPanel && <WhatRuns node={node} folded />}

              {/* Beside the body, for a node that authors one. */}
              {!steps && openInEditor}
          </div>
          </GenerationReport>
      </div>
    </Modal>
  );
}
