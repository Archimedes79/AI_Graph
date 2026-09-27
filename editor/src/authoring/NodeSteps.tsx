import React, { useEffect, useRef, useState } from 'react';
import type { Graph } from '@/graph';
import { keepsOutputInterface, useGraphStore } from '@/store/graphStore';
import { unmet } from '@engine/execution/examples.ts';
import type { NodePanelProps } from '@/elements/NodeGuiBuilder';
import FourSteps, { RunOncePerItem, TaskField } from './FourSteps';
import ExampleInputField from './ExampleInputField';
import OutputWordsField from './OutputWordsField';
import OutputInterface from './OutputInterface';
import GeneratedBody from './GeneratedBody';
import TryItInline, { ChangeIt, tryNode, useTry, type TryResult } from './TryItInline';
import { readPair, withExpect, withInput, withJudge } from './examplePair';
import { useTyped } from './useTyped';
import { derivedOutputWords } from './derivedOutput';
import { readFilePorts } from './generationContext';
import { outputFormatText } from './outputFormat';
import type { ChangeAsked } from './generation';
import {
  exampleFor, keptExpect, listPorts, ownOutputs, runsPerItem, tryInputs, tryKey, whatCameOf, withPerItem,
} from './nodeStepRules';
import { DANGER_TEXT, DIMMER, FIELD, MUTED } from '@/ui/theme';

type Props = Pick<NodePanelProps,
  'builder' | 'node' | 'setConfig' | 'updateNode' | 'fields' | 'generating' | 'message' | 'onGenerate' | 'steps'
> & {
  /** Step 4 in this element's words, and what it lays out under its body: an ai node's message. */
  body: { title: string; hint: string; beside?: React.ReactNode };
  /** What "Run once per item" calls the node: "this code", "the model". */
  subject: string;
  /**
   * Drawn in Try it above its button: an ai node's request, as its model will
   * read it -- for the example, in the graph with this node in it.
   */
  request?: (example: Record<string, unknown> | undefined, graph: () => Graph) => React.ReactNode;
  /** What came out of a try, drawn the element's own way. */
  renderResult?: (result: TryResult) => React.ReactNode;
  /** What step 2's words mean for this node, said above them: who reads them, and when. */
  wordsHint: string;
  /**
   * What "Keep as expected output" does with a result, where it does not make
   * it the example's expected output -- and says so: an ai node's answer is
   * never the same twice, so it is kept as a shape to answer in, in step 2's
   * words (`keptAnswer.withAnswerShape`). Absent, it is the example's expect
   * block, checked by Try it and `test`.
   */
  keep?: { onKeep: (result: TryResult) => void; says: string };
};

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
 * from what the node already holds -- the same sections, in the same order,
 * with the same buttons, for both; only the body differs:
 *
 *   1  its inputs, and the one example they are tried on (the first pair of
 *      its `examples.md`), and "Run once per item" when a list arrives
 *   2  its outputs and where each goes -- what the graph already says, read
 *      only -- the one field of words for what it leaves out, and the shape a
 *      run kept
 *   3  the task
 *   4  the body, and ▶ Try it on the example under it: what came out, whether
 *      it is what the example expects, "Keep as expected output", the judge's
 *      word, and how the other examples did
 *
 * The same pair is what ✨ is written and tried against (`nodeFacts`), what
 * the model's request is shown for, and what `test` runs: one example,
 * wherever a sample is asked for.
 */
export default function NodeSteps({
  builder, node, setConfig, updateNode, fields, generating, message, onGenerate, steps,
  body, subject, request, renderResult, wordsHint, keep: keepOwn,
}: Props) {
  const generation = builder.generation;
  const nodes = useGraphStore((s) => s.rfNodes.map((item) => item.data.graphNode));
  const edges = useGraphStore((s) => s.rfEdges);

  const examples = String(node.config.examples ?? '');
  const pair = readPair(examples);
  // What the dialog stores is always an object; an examples.md written by
  // hand may hold something else, which is said rather than run.
  const broken = !!pair.inputText.trim() && !pair.input;
  /**
   * The examples changed from what the node holds when the change lands, not
   * from this render's copy: a fill that waits on a run upstream or a file
   * wrote its render's copy back, over an expectation, a judge or a kept
   * result entered while it waited.
   */
  const editExamples = (change: (current: string) => string) =>
    setConfig('examples', (current: unknown) => change(String(current ?? '')));
  const [judgeTyped, typeJudge] = useTyped(pair.judge ?? '', (text) => {
    editExamples((current) => withJudge(exampleFor(node, current), text));
    return readPair(withJudge(exampleFor(node, examples), text)).judge ?? '';
  });
  const lists = listPorts(node, pair.input, nodes, edges);
  // Once asked, the question stays while the dialog is open: unticked, no
  // input is declared a list any more, and the box would vanish under the click.
  const askedPerItem = useRef(false);
  if (lists.length) askedPerItem.current = true;

  // A node that takes nothing in has no example to fill, unless one was written before.
  const exampled = node.inputs.length > 0 || !!pair.inputText.trim();
  const tried = tryInputs(node, pair.input);
  const trying = useTry(
    tryKey(node, tried, generation?.promptField),
    () => tryNode(steps!.graph(), node, tried ?? {}, pair),
  );
  // An expectation that names something: "only that it runs" is `{}`.
  const expects = !!pair.expect && Object.keys(pair.expect).length > 0;
  const result = trying.tried?.result;
  const ran = !!result && result.status !== 'error' && result.status !== 'skipped';
  const gaps = ran && expects && pair.expect ? unmet(pair.expect, ownOutputs(result.outputs)) : undefined;
  const lastRun = useGraphStore((s) => s.executionResult?.node_results.find((one) => one.node_id === node.id));
  const came = whatCameOf(trying.tried, gaps, lastRun);

  // What ✨ wrote -- anew, changed as said, or fixed -- is tried at once, once
  // the node holds it: the loop is say, see, say again.
  const [written, setWritten] = useState(0);
  const triedWritten = useRef(0);
  useEffect(() => {
    if (written === triedWritten.current) return;
    triedWritten.current = written;
    if (tried) void trying.start();
  }, [written, tried, trying]);
  const write = async (change?: ChangeAsked): Promise<boolean> => {
    const done = await onGenerate(change);
    if (done) setWritten((count) => count + 1);
    return done;
  };

  if (!generation || !steps) return null;

  const words = outputFormatText(node.config);
  const setWords = (text: string) => setConfig('output_format_prompt', text);

  // What the example names that is no port of the node's (any more): written
  // by hand, or kept from before a port was renamed outside this dialog.
  // `check` holds every example to the ports; here it is said where it is edited.
  const strayInputs = Object.keys(pair.input ?? {}).filter((key) => !node.inputs.some((port) => port.id === key));
  const strayOutputs = Object.keys(pair.expect ?? {}).filter((key) => !node.outputs.some((port) => port.id === key));
  const named = (keys: string[]) => keys.map((key) => `“${key}”`).join(', ');
  // A change to the body there is, as "Say what to change" and ✨ Fix ask it:
  // the body, what came of it -- and, for a fix, nothing more to change.
  const change = (words?: string): ChangeAsked => ({
    refine: { body: fields.get(generation.targetField), ...(words ? { change: words } : {}), ...came?.said },
    ...(came?.sample ? { sample: came.sample } : {}),
  });
  const bodyWord = `the ${body.title.toLowerCase()}`;

  const comesIn = (
    <>
      {steps.inputs}
      {exampled && <ExampleInputField
        text={pair.inputText}
        onText={(text) => {
          editExamples((current) => withInput(current, text));
          return readPair(withInput(examples, text)).inputText;
        }}
        ports={node.inputs.map((port) => ({ id: port.id, name: port.name }))}
        reads={readFilePorts(node)}
        fromGraph={steps.fromGraph}
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
                {pair.others > 1 ? ' they are' : ' it is'}, and run with it by ▶ Try it and by <code>test</code>. This is the first.
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

  // What comes out is what the graph says -- where each output goes and what
  // the node there wants, and the shape a run kept, all read only -- and one
  // field of words for what the graph cannot say.
  const comesOut = (
    <>
      {steps.outputs}
      <OutputWordsField
        words={words}
        onWords={setWords}
        derived={derivedOutputWords(node, nodes, edges)}
        hint={wordsHint}
      />
      {keepsOutputInterface(node) && <OutputInterface node={node} setConfig={setConfig} />}
    </>
  );

  const keep = keepOwn ?? {
    onKeep: (result: TryResult) => editExamples((current) => withExpect(exampleFor(node, current), keptExpect(result.outputs))),
    says: 'Make what came out the output the example must give: Try it and test hold every later version to it',
  };

  // What a model holds the answer to when the example is tried: how an answer
  // that is never the same twice is checked.
  const judge = (
    <div className="flex items-center gap-2">
      <label className="text-xs whitespace-nowrap" style={{ color: MUTED }} htmlFor="example-judge">Judged by a model</label>
      <input
        id="example-judge"
        className="flex-1 min-w-0 rounded px-2 py-1 text-xs"
        style={FIELD}
        value={judgeTyped}
        onChange={(event) => typeJudge(event.target.value)}
        placeholder="Optional: a sentence the answer must meet, e.g. “Two sentences, no judgement of the story.”"
        aria-label="Judged by a model"
      />
    </div>
  );

  const content = (
    <>
      <GeneratedBody
        generation={generation}
        fields={fields}
        generating={generating}
        message={message}
        onGenerate={() => void write()}
        title={node.label}
        preview={steps.preview}
        sent={steps.sent}
      />
      {body.beside}
      <TryItInline
        canRun={!!tried}
        whyNot={broken ? 'The example in step 1 is not an object keyed by input port.' : 'Fill step 1\'s example first: ⟳ from the graph, 📂 from a file, or drop a file on it.'}
        busy={trying.busy}
        onTry={() => void trying.start()}
        tried={trying.tried}
        gaps={gaps}
        expected={expects ? {
          text: pair.expectText,
          onForget: () => editExamples(noExpectation),
          note: strayOutputs.length > 0 && (
            <span style={{ color: DANGER_TEXT }}>
              {' '}It names {named(strayOutputs)}, which no output is called: <code>test</code> finds {strayOutputs.length > 1 ? 'them' : 'it'} missing.
            </span>
          ),
        } : undefined}
        keep={keep}
        renderResult={renderResult}
        judge={judge}
        after={(
          <ChangeIt
            busy={generating}
            fix={came?.failed ? () => void write(change()) : undefined}
            failure={!trying.tried && came?.failed ? came.said.error : undefined}
            onSay={(words) => write(change(words))}
            body={bodyWord}
          />
        )}
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
