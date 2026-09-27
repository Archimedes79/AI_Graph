import React, { useEffect, useRef } from 'react';
import { call } from '@/api/client';
import { keepsOutputInterface, useGraphStore } from '@/store/graphStore';
import { unmet } from '@engine/execution/examples.ts';
import type { NodePanelProps } from '@/elements/NodeGuiBuilder';
import FourSteps, { RunOncePerItem, TaskField } from './FourSteps';
import ExampleInputField from './ExampleInputField';
import OutputWordsField from './OutputWordsField';
import OutputInterface from './OutputInterface';
import GeneratedBody from './GeneratedBody';
import TryItInline, { clip, type TryResult } from './TryItInline';
import CodeField from './CodeField';
import { readPair, withExpect, withInput } from './examplePair';
import { useTyped } from './useTyped';
import { derivedOutputWords } from './derivedOutput';
import { pathPorts } from './generationContext';
import { fromTheGraph } from './fromTheGraph';
import { outputFormatText } from './outputFormat';
import { keptAnswer, keptExpect, listPorts, runsPerItem, withPerItem } from './nodeStepRules';
import { DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

type Props = Pick<NodePanelProps,
  'builder' | 'node' | 'setConfig' | 'updateNode' | 'setInvalid' | 'generation' | 'fields' | 'generating' | 'message' | 'onGenerate' | 'steps'
> & {
  /** Step 4 in this element's words, and what it lays out under its body: an ai node's message. */
  body: { title: string; hint: string; beside?: React.ReactNode };
  /** What "Run once per item" calls the node: "this code", "the model". */
  subject: string;
  /** Drawn in Try it above its button: an ai node's request, as its model will read it. */
  request?: (example: Record<string, unknown> | undefined) => React.ReactNode;
  /** What came out of a try, drawn the element's own way. */
  renderResult?: (result: TryResult) => React.ReactNode;
};

/** The formats an older version picked from a list, whose words `outputFormatText` still puts in front. */
const PICKED = new Set(['json', 'csv', 'csv_list', 'example']);

/** An expectation of nothing -- "only that it runs" -- is kept as `{}` and shown as an empty box. */
const shownExpect = (text: string): string => (text === '{}' ? '' : text);

/**
 * A code or an ai node, built in the four steps (`FourSteps`), each filled
 * from what the node already holds: its ports, the first pair of its
 * `examples.md` as the example in and out, the words and the kept shape, the
 * task, the body -- and Try it on that same example, under the body.
 *
 * The same pair is what ✨ is written and tried against (`nodeFacts`), what
 * the model's request is shown for, and what `test` runs: one example,
 * wherever a sample is asked for.
 */
export default function NodeSteps({
  builder, node, setConfig, updateNode, setInvalid, generation, fields, generating, message, onGenerate, steps,
  body, subject, request, renderResult,
}: Props) {
  const nodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const edges = useGraphStore((s) => s.rfEdges);
  const executionResult = useGraphStore((s) => s.executionResult);
  const exportGraph = useGraphStore((s) => s.exportGraph);

  const examples = String(node.config.examples ?? '');
  const pair = readPair(examples);
  const answers = builder.exampleOutput === 'answer';
  const inputError = pair.inputText.trim() && !pair.input
    ? 'The example input is not an object keyed by input port yet, like {"input": "…"}. It cannot be saved like this.'
    : '';
  const expectError = !answers && pair.expectText.trim() && !pair.expect
    ? 'The example output is not an object keyed by output port yet, like {"output": "…"}. It cannot be saved like this.'
    : '';
  useEffect(() => setInvalid('example input', inputError), [inputError, setInvalid]);
  useEffect(() => setInvalid('example output', expectError), [expectError, setInvalid]);
  const [expectTyped, typeExpect] = useTyped(shownExpect(pair.expectText), (text) => {
    const next = withExpect(examples, text);
    setConfig('examples', next);
    return shownExpect(readPair(next).expectText);
  });
  const lists = listPorts(node, pair.input, nodes, edges);
  // Once asked, the question stays while the dialog is open: unticked, no
  // input is declared a list any more, and the box would vanish under the click.
  const askedPerItem = useRef(false);
  if (lists.length) askedPerItem.current = true;

  if (!generation || !steps) return null;

  /** The graph on the canvas with this node as the dialog holds it: what is tried is the edit. */
  const graphWithDraft = () => {
    const graph = exportGraph();
    graph.nodes = graph.nodes.map((candidate) => (candidate.id === node.id ? node : candidate));
    return graph;
  };

  const fromGraph = () => fromTheGraph(node, executionResult, graphWithDraft);

  const words = outputFormatText(node.config);
  const setWords = (text: string) => {
    // An older picked format is in front of the words shown; once they are
    // edited, the words are the whole of it.
    if (PICKED.has(String(node.config.output_format))) setConfig('output_format', 'custom');
    setConfig('output_format_prompt', text);
  };

  const comesIn = (
    <>
      {steps.inputs}
      <ExampleInputField
        text={pair.inputText}
        onText={(text) => {
          const next = withInput(examples, text);
          setConfig('examples', next);
          return readPair(next).inputText;
        }}
        error={inputError}
        ports={node.inputs.map((port) => ({ id: port.id, name: port.name }))}
        pathPorts={pathPorts(node, nodes, edges)}
        fromGraph={node.inputs.length ? fromGraph : undefined}
        earlierFile={!pair.input && node.config.example_file ? node.config.example_file : undefined}
        note={pair.others > 0 && (
          <p className="text-xs" style={{ color: DIMMER }}>
            Its examples.md holds {pair.others} more example{pair.others > 1 ? 's' : ''} after this one: kept there as
            {pair.others > 1 ? ' they are' : ' it is'}, and still run by <code>test</code>. This is the first.
          </p>
        )}
      />
      {askedPerItem.current && (
        <RunOncePerItem
          checked={runsPerItem(node)}
          onChange={(perItem) => updateNode((current) => withPerItem(current, perItem, lists))}
          subject={subject}
        />
      )}
    </>
  );

  const exampleOutput = answers ? (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }}>Example answer</label>
        {node.config.output_example && (
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => setConfig('output_example', '')}>Clear</button>
        )}
      </div>
      <p className="text-xs mb-1" style={{ color: DIMMER }}>
        Shown to the model on every run, to answer in the same shape with new content. Keep one from Try it below, or write it.
      </p>
      <textarea
        className="w-full rounded-lg px-2 py-1.5 text-sm font-mono resize-y"
        style={{ ...FIELD, minHeight: 56 }}
        value={String(node.config.output_example ?? '')}
        onChange={(event) => setConfig('output_example', event.target.value)}
        placeholder="An answer you liked"
        spellCheck={false}
        aria-label="Example answer"
      />
    </div>
  ) : (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Example output</label>
      <p className="text-xs mb-1" style={{ color: DIMMER }}>
        What the example in step 1 must give -- only the outputs and fields written here are compared. Empty: only
        that it runs. Keep one from Try it below, or write it.
      </p>
      <CodeField
        value={expectTyped}
        onChange={typeExpect}
        language="javascript"
        placeholder={`{ ${node.outputs.filter((port) => port.id !== 'error').map((port) => `"${port.id}": …`).join(', ') || '"output": …'} }`}
        minHeight={56}
        title="Example output"
      />
      {expectError && <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>{expectError}</p>}
      {pair.judge && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>A model also judges it: “{pair.judge}”</p>
      )}
      {/* A result to imitate, kept by "Example of the output" in an older
          version: still told to ✨, so shown, and dropped here by whoever no
          longer wants it said. */}
      {String(node.config.output_example ?? '').trim() && (
        <p className="text-xs mt-1 flex items-start gap-1.5" style={{ color: DIMMER }}>
          <span className="flex-1 min-w-0">Kept before as an example of the output, and still told to ✨: “{clip(String(node.config.output_example).trim(), 200)}”</span>
          <button className="text-xs px-1 rounded flex-shrink-0" style={NEUTRAL_BUTTON}
            aria-label="Drop the example of the output kept before"
            onClick={() => setConfig('output_example', '')}>
            ✕
          </button>
        </p>
      )}
    </div>
  );

  const comesOut = (
    <>
      {steps.outputs}
      {builder.outputContract === 'format' && (
        <OutputWordsField
          words={words}
          onWords={setWords}
          derived={derivedOutputWords(node, nodes, edges)}
          hint={builder.outputFormatHint}
        />
      )}
      {builder.exampleOutput && exampleOutput}
      {keepsOutputInterface(node) && (
        <details className="rounded-lg">
          <summary className="text-xs cursor-pointer select-none" style={{ color: MUTED }}>The shape a run kept</summary>
          <div className="pt-1.5"><OutputInterface node={node} setConfig={setConfig} /></div>
        </details>
      )}
    </>
  );

  const keep = (result: TryResult) => (answers
    ? setConfig('output_example', keptAnswer(node, result.outputs))
    : setConfig('examples', withExpect(examples, keptExpect(result.outputs))));

  const content = (
    <>
      <GeneratedBody
        generation={generation}
        fields={fields}
        generating={generating}
        message={message}
        onGenerate={onGenerate}
        title={node.label}
        preview={steps.preview}
        sent={steps.sent}
      />
      {body.beside}
      <TryItInline
        canRun={!!pair.input && !inputError}
        whyNot={inputError ? 'The example in step 1 is not an object yet.' : 'Fill step 1\'s example first: ⟳ from the graph, or 📂 from a file.'}
        run={() => call('runNode', { ...graphWithDraft(), node_id: node.id, inputs: pair.input ?? {} })}
        verdict={answers ? undefined : (outputs) => (pair.expect && Object.keys(pair.expect).length ? unmet(pair.expect, outputs) : undefined)}
        onKeep={keep}
        renderResult={renderResult}
      >
        {request?.(pair.input)}
      </TryItInline>
      {steps.openInEditor}
    </>
  );

  return (
    <FourSteps
      comesIn={comesIn}
      comesOut={comesOut}
      task={{ field: <TaskField generation={generation} fields={fields} /> }}
      body={{ title: body.title, hint: body.hint, content }}
    />
  );
}
