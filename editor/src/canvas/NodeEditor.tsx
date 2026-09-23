import { Suspense, useEffect, useRef, useState } from 'react';
import type { GraphNode, Port } from '@/graph';
import { keepsExamples, keepsOutputInterface, useGraphStore } from '@/store/graphStore';
import { derivedNodePorts, syncGuiNodePorts } from '@/document/guiWidgets';
import PortsEditor from './PortsEditor';
import { NODE_BUILDERS } from '@/elements/registry';
import Modal from '@/ui/Modal';
import { useGenerate } from '@/authoring/useGenerate';
import { buildGeneration, nodeFields, previewGeneration, type GenerationRequest } from '@/authoring/generation';
import { connectedFormatContext, inputSources, lastRunContext, outputTargets, readFilePorts } from '@/authoring/generationContext';
import { nodeFacts } from '@/authoring/nodeFacts';
import { inferInterface } from '@engine/execution/interface.ts';
import OutputFormatEditor from '@/authoring/OutputFormatEditor';
import OutputInterface from '@/authoring/OutputInterface';
import NodeExamples from '@/authoring/NodeExamples';
import { nodeLogic } from '@/authoring/logic';
import GenerationTranscript, { GenerationReport, SentPart } from '@/authoring/GenerationTranscript';
import WidgetOutputSummary from '@/elements/nodes/gui/WidgetOutputSummary';
import WhatRuns from '@/elements/fields/WhatRuns';
import { connectedOutputDataNodes } from '@/elements/nodes/data/dataFormat';
import { call, type AICall } from '@/api/client';
import { errorText } from '@/api/errorText';
import { ACCENT_FILL, ACCENT_TEXT, FIELD, LINE, MUTED, NEUTRAL_BUTTON, PRIMARY_BUTTON, TEXT } from '@/ui/theme';

interface NodeEditorProps {
  nodeId: string;
  onClose: () => void;
}

/** The output a node grows when it is told to catch its own failures. */
const ERROR_OUTPUT: Port = {
  id: 'error',
  name: 'Error',
  kind: 'output',
  data_type: 'text',
  multi: false,
  required: false,
  description: 'Why this node failed. Optional to wire: unwired, the run simply carries on.',
};

export default function NodeEditor({ nodeId, onClose }: NodeEditorProps) {
  const rfNode = useGraphStore((s) => s.rfNodes.find((n) => n.id === nodeId));
  const updateNode = useGraphStore((s) => s.updateNode);
  const graphNodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const graphEdges = useGraphStore((s) => s.rfEdges);
  // The last run's per-node values: the best generation context available, and
  // it was sitting in the store unused.
  const executionResult = useGraphStore((s) => s.executionResult);

  const isProject = useGraphStore((s) => s.isProject);

  const [node, setNode] = useState<GraphNode | null>(null);
  const [externalStatus, setExternalStatus] = useState('');
  // The store's copy of this node as the draft last matched it, and a newer
  // one that arrived while the draft held edits of its own.
  const baseline = useRef('');
  const draft = useRef<GraphNode | null>(null);
  draft.current = node;
  const [newer, setNewer] = useState<GraphNode | null>(null);
  // What ✨ Generate would send, when asked: shown, not sent.
  const [sends, setSends] = useState<AICall[] | null>(null);
  const [sendsNote, setSendsNote] = useState('');
  // One state machine for all four ✨ Generate buttons in this editor.
  const generate = useGenerate();
  const generating = generate.busy;
  const genMessage = generate.message();

  // The node can change while this dialog is open: its code edited in
  // another editor, its interface set by a run. An untouched draft simply
  // follows; a draft with edits of its own is not overwritten -- the person is
  // asked which to keep.
  useEffect(() => {
    if (!rfNode) return;
    const incoming = JSON.stringify(rfNode.data.graphNode);
    if (incoming === baseline.current) return;
    if (!draft.current || JSON.stringify(draft.current) === baseline.current) {
      baseline.current = incoming;
      setNode(JSON.parse(incoming));
      setNewer(null);
    } else {
      setNewer(JSON.parse(incoming));
    }
  }, [rfNode]);

  const takeNewer = () => {
    if (!newer) return;
    baseline.current = JSON.stringify(newer);
    setNode(newer);
    setNewer(null);
  };
  const keepMine = () => {
    if (!newer) return;
    baseline.current = JSON.stringify(newer);
    setNewer(null);
  };

  if (!node) return null;

  // No tabs. There were two: Config, and a Preview that printed the node's own
  // JSON. Nobody edits a graph by reading its serialization -- it answered a
  // question ("what did that setting actually store?") that the file on disk
  // answers better, and it cost every node a tab bar to get to the one tab that
  // does something. What a node emits was a third tab for two of six types; it
  // is a declaration now (`outputContract`) and sits in Config under the body.
  const element = NODE_BUILDERS[node.node_type];

  /**
   * What each port was called when this dialog opened, by position.
   *
   * A port's id is the name a body reads it by, so it is edited here — and an
   * edge points at the old one. Matching by position is what the list editor
   * actually does to them: row 2 stayed row 2, whatever it is now called.
   */
  const renamedPorts = () => {
    const was = rfNode?.data.graphNode;
    const map = (before: Port[] = [], after: Port[] = []) => Object.fromEntries(
      before
        .map((port, at) => [port.id, after[at]?.id])
        .filter(([from, to]) => to && from !== to),
    ) as Record<string, string>;
    return { inputs: map(was?.inputs, node!.inputs), outputs: map(was?.outputs, node!.outputs) };
  };

  const save = () => {
    updateNode(nodeId, node, renamedPorts());
    onClose();
  };

  /**
   * Close, but not silently over unsaved work.
   *
   * Everything edited here -- including a snippet an AI just spent a minute
   * generating -- lives in this modal's draft until Save. Cancel and Escape
   * used to discard it without a word, so "✅ Transform generated!" followed by
   * Escape lost the code and left no trace of why.
   */
  /**
   * Hand this node's file to the person's own editor.
   *
   * The draft is taken and the project saved first, so the file holds what
   * the dialog shows. What is saved there comes back by itself: the editor
   * watches the project folder (see App.tsx).
   */
  const openInOwnEditor = async () => {
    const state = useGraphStore.getState();
    if (!state.currentFilePath || !state.isProject) return;
    try {
      setExternalStatus('Saving, then opening…');
      updateNode(nodeId, node!);
      baseline.current = JSON.stringify(node);
      const after = useGraphStore.getState();
      await call('saveGraph', { path: state.currentFilePath, graph: after.rootGraph() });
      after.markSaved();
      const opened = await call('openExternal', { graph_path: state.currentFilePath, node_id: nodeId });
      setExternalStatus(`Opened in ${opened.with}: ${opened.path}. What you save there appears here by itself.`);
    } catch (error) {
      setExternalStatus(errorText(error, 'Could not open the file.'));
    }
  };

  const closeWithGuard = () => {
    const stored = rfNode ? JSON.stringify(rfNode.data.graphNode) : '';
    if (JSON.stringify(node) !== stored
        && !window.confirm('Discard the changes to this node?')) return;
    onClose();
  };

  const setConfig = (key: string, value: unknown) => {
    setNode((prev) => {
      if (!prev) return prev;
      const next = { ...prev, config: { ...prev.config, [key]: value } };
      // A setting an element derives its ports from has just changed, so the
      // ports follow it here and now. They used to follow only on the next
      // load, which is why ticking "catch failures" on an input node grew its
      // error port sometime later, to a person who had gone looking for it.
      const derived = derivedNodePorts(next);
      if (derived) return { ...next, ...derived };
      // Ticking "catch failures" is what puts the port on the node. Nobody
      // should have to add an output by hand and guess that it must be called
      // `error` for the executor to fill it.
      if (key === 'catch_errors') {
        const without = next.outputs.filter((port) => port.id !== 'error');
        next.outputs = value ? [...without, ERROR_OUTPUT] : without;
      }
      return next;
    });
  };

  /**
   * Everything the generator should know beyond the user's own description:
   * what the neighbours declare, and what actually flowed through this node the
   * last time the graph ran.
   */
  const surroundingContext = () => [
    connectedFormatContext(node.id, graphNodes, graphEdges),
    lastRunContext(node.id, executionResult, readFilePorts(node)),
  ].filter(Boolean).join('\n\n');

  const setDescription = (value: string) =>
    setNode((prev) => (prev ? { ...prev, description: value } : prev));

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
  const canGenerate = !!generation && (generation.available?.(node) ?? true);
  const fields = nodeFields(node, setConfig, setDescription);
  /** Everything ✨ Generate is told, in one request: the button and its preview send the same. */
  const generationRequest = (): GenerationRequest<GraphNode> | undefined => generation && ({
      element: node.node_type,
      generation,
      subject: node,
      fields,
      // What the node says about itself -- ports, samples, wiring, format,
      // shape, examples -- as facts the engine writes one brief from.
      ...nodeFacts(node, graphNodes, graphEdges, executionResult),
      // A node whose body is written against its ports -- ai and code -- says
      // everything in those facts. The others (a data node's format, an
      // input's file selector) are still told their neighbours in sentences.
      graphContext: element.outputContract === 'format' ? undefined : surroundingContext(),
      recordShape: keepsOutputInterface(node)
        ? (outputs) => { if (!draft.current?.config.output_schema) setConfig('output_schema', inferInterface(outputs)); }
        : undefined,
    });
  const handleGenerate = () => {
    const request = generationRequest();
    if (request) generate.run(buildGeneration(request));
  };
  const showSends = async () => {
    const request = generationRequest();
    if (!request) return;
    if (sends) { setSends(null); return; }
    setSendsNote('Building the request…');
    try {
      setSends(await previewGeneration(request));
      setSendsNote('');
    } catch (error) {
      setSendsNote(errorText(error, 'Could not build the request.'));
    }
  };

  const applyDataFormat = (format: GraphNode['config']['data_format']) => {
    const structured = format === 'structure';
    const dataType = structured ? 'json' : 'text';
    const portFormat = structured ? 'application/json' : 'text/plain';
    setNode((previous) => previous ? {
      ...previous,
      inputs: previous.inputs.map((port) => ({ ...port, data_type: dataType, format: portFormat })),
      outputs: previous.outputs.map((port) => ({ ...port, data_type: dataType, format: portFormat })),
      config: { ...previous.config, data_format: format },
    } : previous);
  };

  const Panel = element.Panel;

  const applyWidgets = (nextWidgets: GraphNode['config']['gui_widgets']) => {
    setNode((prev) => {
      if (!prev) return prev;
      return syncGuiNodePorts({ ...prev, config: { ...prev.config, gui_widgets: nextWidgets } });
    });
  };

  const applyInputMode = (mode: 'text' | 'file' | 'directory') => {
    setNode((prev) => {
      if (!prev) return prev;
      // Changing the mode changes the ports, and the element is what knows
      // which: a folder emits files and count, a file content and path. This
      // used to be a second list here, which is how one of them came to
      // disagree with what the node actually emits.
      const next = { ...prev, config: { ...prev.config, input_mode: mode } };
      const ports = derivedNodePorts(next);
      return ports ? { ...next, inputs: ports.inputs, outputs: ports.outputs } : next;
    });
  };

  // What each port is wired to, in words, shown under the port.
  const wiring = {
    inputs: inputSources(node.id, graphNodes, graphEdges),
    outputs: outputTargets(node.id, graphNodes, graphEdges),
  };
  const setPorts = ({ inputs, outputs }: { inputs: Port[]; outputs: Port[] }) =>
    setNode((prev) => (prev ? { ...prev, inputs, outputs } : prev));
  const ports = (side: 'inputs' | 'outputs' | 'both') => (
    <PortsEditor
      inputs={node.inputs}
      outputs={node.outputs}
      onChange={setPorts}
      side={side}
      editing={element.portEditing}
      hints={{ inputs: element.portHint('inputs', node), outputs: element.portHint('outputs', node) }}
      wiring={wiring}
    />
  );
  const outputFormat = element.outputContract === 'format' && (
    <OutputFormatEditor
      node={node}
      setConfig={setConfig}
      connectedDataNodes={connectedOutputDataNodes(node.id, graphNodes, graphEdges)}
      executionResult={executionResult}
    >
      {keepsOutputInterface(node) && (
        <OutputInterface node={node} setConfig={setConfig} executionResult={executionResult} />
      )}
    </OutputFormatEditor>
  );
  // The dialog as the steps of building the node, for an element that asks
  // for it: its ports inside "what comes in" and "what comes out", the format
  // and the kept shape with the outputs, and "what ✨ sends" beside ✨.
  const steps = element.stepped && derivedNodePorts(node) === null ? {
    inputs: ports('inputs'),
    outputs: <>{ports('outputs')}{outputFormat}</>,
    preview: (
      <button onClick={showSends} className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON}
        title="Show the request ✨ Generate would send -- everything the model is told -- without sending it">
        {sends ? 'Hide what ✨ sends' : 'What ✨ sends'}
      </button>
    ),
    sent: (sends || sendsNote) ? (
      <div className="mb-2 space-y-2 text-xs" aria-label="What Generate sends">
        {sendsNote && <p style={{ color: MUTED }}>{sendsNote}</p>}
        {sends?.[0] && (
          <>
            <p style={{ color: MUTED }}>
              The first request ✨ Generate sends, word for word.
            </p>
            <SentPart label="System" text={sends[0].system} />
            <SentPart label="Prompt" text={sends[0].prompt} />
          </>
        )}
      </div>
    ) : undefined,
  } : undefined;

  return (
    <Modal
      title={
        <input
          className="text-lg font-bold bg-transparent border-none outline-none w-full"
          style={{ color: TEXT }}
          value={node.label}
          aria-label="Node label"
          onChange={(e) => setNode((prev) => prev ? { ...prev, label: e.target.value } : prev)}
        />
      }
      onClose={closeWithGuard}
      maxWidth="max-w-2xl"
      scrollBody
      // The editor holds unsaved edits; a stray backdrop click must not throw
      // them away. Escape is left working because it is what Cancel does.
      dismissOnBackdrop={false}
      footer={
        <>
          <button
            onClick={closeWithGuard}
            className="px-4 py-2 text-sm rounded-lg"
            style={NEUTRAL_BUTTON}
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 text-sm rounded-lg font-semibold"
            style={PRIMARY_BUTTON}
          >
            Save
          </button>
        </>
      }
    >
      <div className="px-6 py-5">
          {newer && (
            <div className="mb-4 px-3 py-2 rounded-lg text-sm flex flex-wrap items-center gap-2"
              style={{ background: ACCENT_FILL, color: ACCENT_TEXT }} role="alert">
              <span className="flex-1 min-w-0">
                This node changed while it was open here — in its project files, or by a run.
              </span>
              <button className="text-xs px-2 py-1 rounded" style={PRIMARY_BUTTON} onClick={takeNewer}>Take that version</button>
              <button className="text-xs px-2 py-1 rounded" style={NEUTRAL_BUTTON} onClick={keepMine}>Keep mine</button>
            </div>
          )}
          {/* Only for elements whose own editor does not already ask what the
              node is for. An ai node's description IS its generation prompt, so
              drawing this above it showed the same box twice. */}
          {!NODE_BUILDERS[node.node_type]?.ownsDescription && (
            <div className="mb-4">
              <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
                Description (optional)
              </label>
              <textarea
                className="w-full rounded-lg px-3 py-2 text-sm resize-none"
                style={{ ...FIELD, minHeight: 64 }}
                value={node.description}
                onChange={(e) => setNode((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                placeholder={element.hint}
              />
            </div>
          )}

          <GenerationReport
            calls={generate.transcript()}
            live={generate.liveTranscript()}
            review={{ pending: generate.isPending(), accept: () => generate.accept(), discard: () => generate.discard() }}
          >
          <div className="space-y-4">
              {/* A panel is its own chunk, loaded when a node is first opened. */}
              {Panel && <Suspense fallback={null}><Panel
                builder={element}
                node={node}
                setConfig={setConfig}
                setDescription={(value: string) => setNode((prev) => (prev ? { ...prev, description: value } : prev))}
                generation={generation}
                fields={fields}
                generating={generating}
                message={genMessage}
                onGenerate={handleGenerate}
                canGenerate={canGenerate}
                applyMode={applyInputMode}
                applyDataFormat={applyDataFormat}
                applyWidgets={applyWidgets}
                contextFile={node.config.example_file ?? ''}
                onContextFileChange={(path: string) => setConfig('example_file', path)}
                steps={steps}
              /></Suspense>}

              {/* What this node takes in and hands out, where that is the
                  person's to say. A gui node's ports follow its blocks and an
                  input node's follow its mode, and the element is what knows
                  which -- so the question is asked, never switched on a type. */}
              {!steps && derivedNodePorts(node) === null && (
                <details className="rounded-lg" open style={{ border: `1px solid ${LINE}` }}>
                  <summary className="px-3 py-2 text-xs font-medium cursor-pointer select-none" style={{ color: MUTED }}>
                    {element.portEditing.outputs === 'none' ? 'Ports — what comes in' : 'Ports — what goes in and comes out'}
                  </summary>
                  <div className="px-3 pb-3 pt-1">
                    {ports('both')}
                  </div>
                </details>
              )}

              {!steps && outputFormat}
              {element.outputContract === 'widgets' && <WidgetOutputSummary node={node} />}
              {!steps && !outputFormat && keepsOutputInterface(node) && (
                <OutputInterface node={node} setConfig={setConfig} executionResult={executionResult} />
              )}
              {keepsExamples(node) && (
                <NodeExamples node={node} setConfig={setConfig} executionResult={executionResult} />
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

              {isProject && nodeLogic(node) && (
                <div>
                  <button
                    onClick={openInOwnEditor}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={NEUTRAL_BUTTON}
                    title="Saves the project, then opens this node's file — in VS Code when it is installed"
                  >
                    ↗ Open in my editor
                  </button>
                  {externalStatus && (
                    <p className="text-xs mt-1" style={{ color: MUTED }}>{externalStatus}</p>
                  )}
                </div>
              )}

              {/* An element with no ✨ button of its own can still have something
                  to report -- the message is drawn next to the button otherwise. */}
              {genMessage && !generation && (
                <div className="text-sm px-3 py-2 rounded" style={{ background: ACCENT_FILL, color: ACCENT_TEXT }}>
                  {genMessage}
                </div>
              )}
              {!generation && <GenerationTranscript />}
          </div>
          </GenerationReport>
      </div>
    </Modal>
  );
}
