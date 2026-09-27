import { useEffect } from 'react';
import FourSteps, { TaskField } from '@/authoring/FourSteps';
import ExampleInputField from '@/authoring/ExampleInputField';
import GeneratedBody from '@/authoring/GeneratedBody';
import Step from '@/authoring/Step';
import { asExampleText } from '@/authoring/examplePair';
import { fromTheGraph } from '@/authoring/fromTheGraph';
import { useTyped } from '@/authoring/useTyped';
import { useGraphStore } from '@/store/graphStore';
import { DANGER_SOFT, DIMMER, FIELD, LINE, MUTED, SUNKEN, TEXT } from '@/ui/theme';
import type { NodePanelProps } from '../../NodeGuiBuilder';
import { asEditableText, convertedValue, dataKind, storedValue, type DataKind } from './dataFormat';

/**
 * A data node: the four steps -- what arrives, what it hands on, what it
 * holds, its format -- and after them, what it holds now, which is its example.
 *
 * What it holds is edited as what it is. The box used to follow only the Kind
 * setting: an object a run had left in a node set to Text was saved back as a
 * string at the first keystroke, a string could not be edited at all under
 * Structure, and valid JSON was re-indented under the caret. Now the value
 * says what it is where it can (`dataKind`), switching the Kind converts it,
 * and a box that does not parse holds up Save rather than being dropped by it.
 */
export default function DataNodePanel({
  builder, node, setConfig, setInvalid, fields, generating, message, onGenerate, steps,
}: NodePanelProps) {
  const generation = builder.generation;
  const executionResult = useGraphStore((s) => s.executionResult);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const kind = dataKind(node);
  const held = node.config.data_value;
  const shown = asEditableText(held, kind);
  // The box keeps what is typed; the stored value is what it parses to. What
  // does not parse is not stored -- the box says so, and Save waits for it.
  const [content, type] = useTyped(shown, (text) => {
    const result = storedValue(text, kind);
    if ('error' in result) return shown;
    setConfig('data_value', result.value);
    return asEditableText(result.value, kind);
  });
  const typed = storedValue(content, kind);
  const contentError = 'error' in typed ? typed.error : '';

  useEffect(() => setInvalid('held value', contentError), [contentError, setInvalid]);

  if (!generation || !steps) return null;

  const switchKind = (next: DataKind) => {
    setConfig('data_format', next);
    // What the box holds but could not store yet is the person's latest word:
    // it is stored under the new kind when it can be. Otherwise the held
    // value is converted.
    const retyped = storedValue(content, next);
    if (!contentError) setConfig('data_value', convertedValue(held, next));
    else if (!('error' in retyped)) setConfig('data_value', retyped.value);
  };

  const graphWithDraft = () => {
    const graph = exportGraph();
    graph.nodes = graph.nodes.map((candidate) => (candidate.id === node.id ? node : candidate));
    return graph;
  };

  // Its example is what it holds, so the two ways to fill an example fill that.
  const example = held === null || held === undefined || held === '' ? '' : asExampleText({ input: held });
  const takeExample = (text: string): string => {
    try {
      const value = (JSON.parse(text) as Record<string, unknown>).input;
      if (value !== undefined) setConfig('data_value', value);
    } catch {
      // Only ever handed JSON of our own making.
    }
    return text;
  };

  const kindSelect = (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>Kind</label>
      <select
        className="w-full rounded px-2 py-2 text-sm"
        style={FIELD}
        value={kind}
        onChange={(event) => switchKind(event.target.value as DataKind)}
        aria-label="Kind"
      >
        <option value="text">Text</option>
        <option value="structure">Structure (JSON)</option>
      </select>
      {kind !== node.config.data_format && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>It holds structured data, so it is edited and described as structure.</p>
      )}
    </div>
  );

  return (
    <>
      <FourSteps
        comesIn={(
          <>
            {steps.inputs}
            <ExampleInputField
              label="Its example: what it holds"
              text={example}
              onText={takeExample}
              showField={false}
              ports={node.inputs.map((port) => ({ id: port.id, name: port.name }))}
              pathPorts={[]}
              fromGraph={node.inputs.length ? () => fromTheGraph(node, executionResult, graphWithDraft) : undefined}
              earlierFile={!example && node.config.example_file ? node.config.example_file : undefined}
              note={<p className="text-xs" style={{ color: DIMMER }}>These fill what it holds now, below: the example ✨ is shown.</p>}
            />
          </>
        )}
        comesOut={(
          <>
            {steps.outputs}
            <p className="text-xs" style={{ color: DIMMER }}>What it hands on is what it holds, in the format of step 4.</p>
          </>
        )}
        task={{
          title: 'What should it hold?',
          hint: 'In your own words. ✨ Generate writes the format in step 4 from this, what it holds now and what it is wired to.',
          field: <TaskField generation={generation} fields={fields} />,
        }}
        body={{
          title: 'Its format',
          hint: 'The kind, then the fields, types and limits in it -- what the nodes wired to it are written against.',
          content: (
            <>
              {kindSelect}
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
              {steps.openInEditor}
            </>
          ),
        }}
      />
      <Step title="What it holds now" hint="Kept between runs. What arrives on its input replaces it; until then this is what it hands on.">
        <div>
          <textarea
            className="w-full rounded-lg px-3 py-2 text-sm resize-y font-mono"
            style={{ background: SUNKEN, color: TEXT, border: `1px solid ${contentError ? DANGER_SOFT : LINE}`, minHeight: 160 }}
            value={content}
            onChange={(event) => type(event.target.value)}
            spellCheck={false}
            aria-label="What it holds now"
          />
          {contentError && <p className="text-xs mt-1" style={{ color: DANGER_SOFT }}>{contentError} It cannot be saved like this.</p>}
        </div>
      </Step>
    </>
  );
}
