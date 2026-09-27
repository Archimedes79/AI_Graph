import React, { useEffect, useRef } from 'react';
import type { Graph } from '@/graph';
import { call } from '@/api/client';
import { keepsOutputInterface, useGraphStore } from '@/store/graphStore';
import { unmet } from '@engine/execution/examples.ts';
import { ERROR_PORT } from '@engine/execution/wiring.ts';
import type { NodePanelProps } from '@/elements/NodeGuiBuilder';
import FourSteps, { RunOncePerItem, TaskField } from './FourSteps';
import ExampleInputField from './ExampleInputField';
import OutputWordsField from './OutputWordsField';
import OutputInterface from './OutputInterface';
import GeneratedBody from './GeneratedBody';
import TryItInline, { clip, type TryResult } from './TryItInline';
import TestEveryExample from './TestEveryExample';
import CodeField from './CodeField';
import { readPair, withExpect, withInput, withJudge } from './examplePair';
import { useTyped } from './useTyped';
import { derivedOutputWords } from './derivedOutput';
import { pathPorts } from './generationContext';
import { outputFormatText } from './outputFormat';
import { exampleFor, keptExpect, listPorts, runsPerItem, tryInputs, withPerItem } from './nodeStepRules';
import { DANGER_TEXT, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

type Props = Pick<NodePanelProps,
  'builder' | 'node' | 'setConfig' | 'updateNode' | 'setInvalid' | 'fields' | 'generating' | 'message' | 'onGenerate' | 'steps'
> & {
  /** Step 4 in this element's words, and what it lays out under its body: an ai node's message. */
  body: { title: string; hint: string; beside?: React.ReactNode };
  /** What "Run once per item" calls the node: "this code", "the model". */
  subject: string;
  /**
   * Drawn in Try it above its button: an ai node's request, as its model will
   * read it -- for the example, in the graph with this draft in it.
   */
  request?: (example: Record<string, unknown> | undefined, graph: () => Graph) => React.ReactNode;
  /** What came out of a try, drawn the element's own way. */
  renderResult?: (result: TryResult) => React.ReactNode;
  /** What step 2's words mean for this node, said above them: who reads them, and when. */
  wordsHint: string;
  /**
   * Step 2's example output, where it is an answer a model is shown to
   * imitate rather than an output the example must give (an ai node's
   * `output_example`): the element's own field, and how Try it's "Keep"
   * keeps a result there. Absent, it is the example's expect block, checked
   * by Try it, ▶ Test and `test`.
   */
  answer?: { field: React.ReactNode; keep: (result: TryResult) => void };
};

/** An expectation of nothing -- "only that it runs" -- is kept as `{}` and shown as an empty box. */
const shownExpect = (text: string): string => (text === '{}' ? '' : text);

/**
 * *examples* with the first pair's expectation taken back to "only that it
 * runs" -- or away, beside a judge, which checks the answer instead (`withJudge`).
 */
const noExpectation = (examples: string): string => {
  const { judge } = readPair(examples);
  const emptied = withExpect(examples, '');
  return judge ? withJudge(emptied, judge) : emptied;
};

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
  builder, node, setConfig, updateNode, setInvalid, fields, generating, message, onGenerate, steps,
  body, subject, request, renderResult, wordsHint, answer,
}: Props) {
  const generation = builder.generation;
  const nodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const edges = useGraphStore((s) => s.rfEdges);

  const examples = String(node.config.examples ?? '');
  const pair = readPair(examples);
  const answers = !!answer;
  const inputError = pair.inputText.trim() && !pair.input
    ? 'The example input is not an object keyed by input port yet, like {"input": "…"}. It cannot be saved like this.'
    : '';
  const expectError = !answers && pair.expectText.trim() && !pair.expect
    ? 'The example output is not an object keyed by output port yet, like {"output": "…"}. It cannot be saved like this.'
    : '';
  useEffect(() => setInvalid('example input', inputError), [inputError, setInvalid]);
  useEffect(() => setInvalid('example output', expectError), [expectError, setInvalid]);
  /**
   * The examples changed from what the draft holds when the change lands, not
   * from this render's copy: a fill that waits on a run upstream or a file
   * wrote its render's copy back, over an expectation, a judge or a kept
   * result entered while it waited.
   */
  const editExamples = (change: (current: string) => string) =>
    setConfig('examples', (current: unknown) => change(String(current ?? '')));
  const [expectTyped, typeExpect] = useTyped(shownExpect(pair.expectText), (text) => {
    editExamples((current) => withExpect(exampleFor(node, current), text));
    return shownExpect(readPair(withExpect(exampleFor(node, examples), text)).expectText);
  });
  const [judgeTyped, typeJudge] = useTyped(pair.judge ?? '', (text) => {
    editExamples((current) => withJudge(exampleFor(node, current), text));
    return readPair(withJudge(exampleFor(node, examples), text)).judge ?? '';
  });
  const lists = listPorts(node, pair.input, nodes, edges);
  // Once asked, the question stays while the dialog is open: unticked, no
  // input is declared a list any more, and the box would vanish under the click.
  const askedPerItem = useRef(false);
  if (lists.length) askedPerItem.current = true;

  if (!generation || !steps) return null;

  const words = outputFormatText(node.config);
  const setWords = (text: string) => {
    // An older picked format is in front of the words shown; once they are
    // edited, the words are the whole of it, and the choice is gone.
    if (node.config.output_format !== undefined) setConfig('output_format', undefined);
    setConfig('output_format_prompt', text);
  };

  // A node that takes nothing in has no example to fill, unless one was written before.
  const exampled = node.inputs.length > 0 || !!pair.inputText.trim();
  const tried = tryInputs(node, pair.input);
  // What the example names that is no port of the node's (any more): written
  // by hand, or kept from before a port was renamed outside this dialog.
  // `check` holds every example to the ports; here it is said where it is edited.
  const strayInputs = Object.keys(pair.input ?? {}).filter((key) => !node.inputs.some((port) => port.id === key));
  const strayOutputs = Object.keys(pair.expect ?? {}).filter((key) => !node.outputs.some((port) => port.id === key));
  const named = (keys: string[]) => keys.map((key) => `“${key}”`).join(', ');
  const strayOutputNote = strayOutputs.length > 0 && (
    <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>
      It names {named(strayOutputs)}, which no output is called: <code>test</code> finds {strayOutputs.length > 1 ? 'them' : 'it'} missing.
    </p>
  );
  // An expectation that names something. An ai node's step 2 asks for an
  // answer to imitate rather than for one, but a file written by hand or by
  // an older dialog can hold one, and `test` holds the answer to it.
  const expects = !!pair.expect && Object.keys(pair.expect).length > 0;

  const comesIn = (
    <>
      {steps.inputs}
      {exampled && <ExampleInputField
        text={pair.inputText}
        onText={(text) => {
          editExamples((current) => withInput(current, text));
          return readPair(withInput(examples, text)).inputText;
        }}
        error={inputError}
        ports={node.inputs.map((port) => ({ id: port.id, name: port.name }))}
        pathPorts={pathPorts(node, nodes, edges)}
        fromGraph={steps.fromGraph}
        earlierFile={!pair.input && node.config.example_file ? node.config.example_file : undefined}
        note={(
          <>
            {strayInputs.length > 0 && (
              <p className="text-xs" style={{ color: DANGER_TEXT }}>
                It gives {named(strayInputs)}, which no input is called: nothing reads {strayInputs.length > 1 ? 'them' : 'it'} by
                that name, and <code>check</code> reports it. Rename or remove it here.
              </p>
            )}
            {pair.others > 0 && (
              <p className="text-xs" style={{ color: DIMMER }}>
                Its examples.md holds {pair.others} more example{pair.others > 1 ? 's' : ''} after this one: kept there as
                {pair.others > 1 ? ' they are' : ' it is'}, and still run by <code>test</code> and by ▶ Test in step 2. This is the first.
              </p>
            )}
          </>
        )}
      />}
      {askedPerItem.current && (
        <RunOncePerItem
          checked={runsPerItem(node)}
          onChange={(perItem) => updateNode((current) => withPerItem(current, perItem, lists))}
          subject={subject}
        />
      )}
    </>
  );

  const exampleOutput = answer ? (
    <div>
      {answer.field}
      {/* Not asked for here, and still checked: shown, so that a `test`
          that fails on it can be seen, and dropped where it is not wanted. */}
      {expects && (
        <div className="text-xs mt-1 flex items-start gap-1.5" style={{ color: DIMMER }}>
          <span className="flex-1 min-w-0">
            <code>test</code> also compares the answer to this, from its examples.md: <code>{clip(pair.expectText.trim(), 200)}</code>
          </span>
          <button className="text-xs px-1 rounded flex-shrink-0" style={NEUTRAL_BUTTON}
            aria-label="Drop the expected output"
            onClick={() => editExamples(noExpectation)}>
            ✕
          </button>
        </div>
      )}
      {strayOutputNote}
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
        placeholder={`{ ${node.outputs.filter((port) => port.id !== ERROR_PORT).map((port) => `"${port.id}": …`).join(', ') || '"output": …'} }`}
        minHeight={56}
        title="Example output"
      />
      {expectError && <p className="text-xs mt-1" style={{ color: DANGER_TEXT }}>{expectError}</p>}
      {strayOutputNote}
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

  // What `test` holds the example's answer to, in a sentence a model judges:
  // how an answer that is never the same twice is checked. Asked of an ai
  // node; a code node's is shown where its file has one. The examples.md
  // editor that was the one place to write it is gone.
  const judgeField = (answers || pair.judge) && (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }} htmlFor="example-judge">
        Judged by a model{answers ? ' (optional)' : ''}
      </label>
      <p className="text-xs mb-1" style={{ color: DIMMER }}>
        A sentence a model holds the answer to the example to, when the example is tested.
        {answers ? ' Empty: testing it only runs it.' : ' Empty: only the example output is compared.'}
      </p>
      <input
        id="example-judge"
        className="w-full rounded-lg px-2 py-1.5 text-sm"
        style={FIELD}
        value={judgeTyped}
        onChange={(event) => typeJudge(event.target.value)}
        placeholder="e.g. Two sentences, and no judgement of the story."
        aria-label="Judged by a model"
      />
    </div>
  );

  // What Try it cannot check -- a judge, the examples after the first, an ai
  // node's expectation -- is checked as `test` checks it.
  const testsMore = pair.others > 0 || !!pair.judge || (answers && expects);

  const comesOut = (
    <>
      {steps.outputs}
      <OutputWordsField
        words={words}
        onWords={setWords}
        derived={derivedOutputWords(node, nodes, edges)}
        hint={wordsHint}
      />
      {exampleOutput}
      {judgeField}
      {testsMore && <TestEveryExample graph={steps.graph} nodeId={node.id} count={pair.others + 1} />}
      {keepsOutputInterface(node) && (
        <details className="rounded-lg">
          <summary className="text-xs cursor-pointer select-none" style={{ color: MUTED }}>The shape a run kept</summary>
          <div className="pt-1.5"><OutputInterface node={node} setConfig={setConfig} /></div>
        </details>
      )}
    </>
  );

  const keep = answer?.keep
    ?? ((result: TryResult) => editExamples((current) => withExpect(exampleFor(node, current), keptExpect(result.outputs))));

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
        canRun={!!tried && !inputError}
        whyNot={inputError ? 'The example in step 1 is not an object yet.' : 'Fill step 1\'s example first: ⟳ from the graph, or 📂 from a file.'}
        run={() => call('runNode', { ...steps.graph(), node_id: node.id, inputs: tried ?? {} })}
        verdict={(outputs) => (expects && pair.expect ? unmet(pair.expect, outputs) : undefined)}
        onKeep={keep}
        renderResult={renderResult}
      >
        {request?.(pair.input, steps.graph)}
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
