import { Suspense } from 'react';
import type { Graph, Port } from '@/graph';
import { call } from '@/api/client';
import { useGraphStore } from '@/store/graphStore';
import { derivedNodePorts } from '@/document/guiWidgets';
import PortsEditor from './PortsEditor';
import { withPorts } from './nodeDraft';
import { useNodeDialog } from './nodeDialog';
import { NODE_BUILDERS } from '@/elements/registry';
import { ONCE, type NodePanelProps, type UndoStep } from '@/elements/NodeGuiBuilder';
import Modal from '@/ui/Modal';
import { useGenerate } from '@/authoring/useGenerate';
import {
  bodyOf, exchangeName, generateRequest, generationGuard, previewGeneration, resultMessage, unfitDefinition, withHistory, writeName, writesFor,
  writtenInto,
  type Refine, type Write,
} from '@/authoring/generation';
import { inputSources, outputTargets } from '@/authoring/generationContext';
import { fileFromTheGraph, inputFilesOf } from '@/authoring/exampleFile';
import { runsPerItem } from '@/authoring/perItem';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
import { GenerationReport } from '@/authoring/GenerationTranscript';
import HeadingField from '@/authoring/HeadingField';
import WhatRuns from '@/elements/fields/WhatRuns';
import { FIELD, LINE, MUTED } from '@/ui/theme';

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
  const metadata = useGraphStore((s) => s.metadata);
  // The last run's per-node values: where the file an input definition is
  // written from may come from.
  const executionResult = useGraphStore((s) => s.executionResult);
  // One state machine for every ✨ in this editor.
  const generate = useGenerate();

  const node = dialog.node();
  if (!node) return null;

  const element = NODE_BUILDERS[node.node_type];
  const caught = node.config.catch_errors === true;

  const setConfig: NodePanelProps['setConfig'] = (key, value, step) => dialog.setConfig(key, value, step);
  const setDescription = (value: string) => dialog.change((current) => ({ ...current, description: value }), { field: 'description' });

  // The graph on the canvas with this node in it as the dialog shows it, read
  // when asked: what is tried, fetched from the graph and sent to ✨ is the
  // edit as it is then.
  const graph = (): Graph => {
    const whole = useGraphStore.getState().exportGraph();
    const current = dialog.node() ?? node;
    whole.nodes = whole.nodes.map((candidate) => (candidate.id === current.id ? current : candidate));
    return whole;
  };
  const around = () => {
    const current = dialog.node() ?? node;
    return { nodes: graphNodes.map((candidate) => (candidate.id === current.id ? current : candidate)), edges: graphEdges, metadata };
  };
  const requestFor = (write: Write, refine?: Refine) => {
    const current = dialog.node() ?? node;
    const { nodes, edges } = around();
    return generateRequest(current, write, around(), inputFilesOf(current, nodes, edges, executionResult), refine);
  };

  /**
   * ✨: *write* -- for the body, what is missing of the definitions first --
   * each through the one route, each written in as it comes, as an undo step
   * of its own, with the exchange at the end of the node's history.md. A
   * definition that does not fit the node stops it there (`unfitDefinition`):
   * what comes after would be written against it. A change or a fix is asked
   * of the body alone. Resolves to whether all of it was written.
   */
  const handleGenerate = async (write: Write, refine?: Refine): Promise<boolean> => {
    const start = dialog.node();
    if (!start) return false;
    for (const one of refine ? ['body' as const] : writesFor(start, write)) {
      const current = dialog.node();
      if (!current) return false;
      const name = exchangeName(current, one, refine);
      const request = requestFor(one, refine);
      let unfit: string | undefined;
      const written = await generate.run({
        guard: () => generationGuard(current),
        pending: `${writeName(current, one)}…`,
        run: (progressId?: string) => call('generate', { ...request, ...(progressId ? { progress_id: progressId } : {}) }),
        apply: (result) => {
          unfit = unfitDefinition(one, result.probe);
          dialog.change((now) => writtenInto(now, one, result, name), ONCE);
        },
        success: (result) => resultMessage(writeName(current, one), result.probe, !!refine?.change?.trim()),
        failure: `${writeName(current, one)} failed`,
        failed: (calls) => dialog.change((now) => ({ ...now, config: { ...now.config, history: withHistory(now, `${name} (failed)`, calls) } }), ONCE),
      });
      if (!written || unfit) return false;
    }
    return true;
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
  const defined = element.definesItself && ownPorts;
  const ports = (
    <PortsEditor
      inputs={node.inputs}
      outputs={node.outputs}
      onChange={setPorts}
      editing={element.portEditing}
      hints={{ inputs: element.portHint('inputs', node), outputs: element.portHint('outputs', node) }}
      wiring={wiring}
      readsFiles={engineRegistry.node(node.node_type)?.readsFileInputs ?? false}
      compact={defined}
      perItem={defined && runsPerItem(node)}
      caught={caught}
    />
  );
  const shell: NodePanelProps['shell'] = bodyOf(node) ? {
    graph,
    preview: (write) => previewGeneration(requestFor(write)),
    graphFile: () => {
      const { nodes, edges } = around();
      return fileFromTheGraph(dialog.node() ?? node, nodes, edges, executionResult, graph);
    },
    flush: () => dialog.write(),
  } : undefined;

  return (
    <Modal
      title={
        <HeadingField heading={node.label} onChange={(label) => dialog.change((current) => ({ ...current, label }))} />
      }
      onClose={onClose}
      maxWidth="max-w-2xl"
      scrollBody
      // A stray click beside it is not a reason to close it.
      dismissOnBackdrop={false}
    >
      <div className="px-6 py-5">
          {/* Only for elements whose own panel does not already draw the
              node's text: a code, ai or data node writes from it. */}
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

          <GenerationReport calls={generate.transcript} live={generate.live}>
          <div className="space-y-4">
              {/* A panel is its own chunk, loaded when a node is first opened. */}
              {Panel && <Suspense fallback={null}><Panel
                builder={element}
                node={node}
                setConfig={setConfig}
                updateNode={(change, step) => dialog.change(change, step)}
                setDescription={setDescription}
                generating={generate.busy}
                message={generate.message}
                onGenerate={handleGenerate}
                shell={shell}
              /></Suspense>}

              {/* What this node takes in and hands out, where that is the
                  person's to say. A gui node's ports follow its blocks and an
                  input node's follow its mode, and the element is what knows
                  which -- so the question is asked, never switched on a type.
                  A node that defines itself keeps them among its Advanced settings. */}
              {!defined && ownPorts && (
                <details className="rounded-lg" open style={{ border: `1px solid ${LINE}` }}>
                  <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
                    {element.portEditing.outputs === 'none' ? 'Ports — what comes in' : 'Ports — what goes in and comes out'}
                  </summary>
                  <div className="px-3 pb-3 pt-1">
                    {ports}
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
                      <element.AdvancedPanel node={node} setConfig={setConfig} updateNode={(change, step) => dialog.change(change, step)}
                        ports={defined ? ports : undefined} />
                    </Suspense>
                    <WhatRuns node={node} />
                  </div>
                </details>
              )}
              {/* Where the work is done, technically: for the curious, so folded. */}
              {!element.AdvancedPanel && <WhatRuns node={node} folded />}
          </div>
          </GenerationReport>
      </div>
    </Modal>
  );
}
