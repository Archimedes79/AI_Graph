import FourSteps, { TaskField } from '@/authoring/FourSteps';
import ExampleInputField from '@/authoring/ExampleInputField';
import GeneratedBody from '@/authoring/GeneratedBody';
import TryItInline from '@/authoring/TryItInline';
import { blockExample } from '@/authoring/blockFacts';
import { blockTryKey, exampleProblem } from '@/authoring/blockStepRules';
import { DIMMER, MUTED } from '@/ui/theme';
import type { WidgetPanelProps } from '../WidgetGuiBuilder';
import { TransformingDisplayGuiBuilder } from './TransformingDisplayGuiBuilder';

/**
 * A chart, a table or an image, built in the four steps every body is: what
 * arrives, and one example of it; what the block shows, which its kind fixes;
 * what it should do; and its code, tried right under it on that example.
 *
 * It was a fold called "(optional)" around a prompt, a 📎 file that was only
 * pasted into ✨'s prompt, and the code -- with Try it at the foot of the
 * editor, on values of its own kept in the browser. The words come from each
 * kind's builder (`shows`); this is the drawing of all three.
 */
export default function TransformingDisplayPanel({
  builder, widget, fields, onUpdate, generating, message, onGenerate, steps,
}: WidgetPanelProps) {
  const generation = builder.generation;
  if (!(builder instanceof TransformingDisplayGuiBuilder) || !generation || !steps) return null;
  const text = String(widget.example ?? '');
  const problem = exampleProblem(text);
  const example = blockExample(widget);

  const comesIn = (
    <>
      <p className="text-xs" style={{ color: steps.feeds ? MUTED : DIMMER }}>
        {steps.feeds
          ? `It is handed what ${steps.feeds} hands on.`
          : 'Nothing is wired into it yet: wire an output into its port on the page\'s node.'}
      </p>
      <ExampleInputField
        text={text}
        onText={(next) => { onUpdate({ example: next }); return next; }}
        error={problem}
        ports={[{ id: 'value', name: 'what arrives' }]}
        pathPorts={builder.runner.readsPaths ? ['value'] : []}
        fromGraph={steps.fromGraph}
        earlierFile={widget.example_file
          ? { path: widget.example_file, drop: () => onUpdate({ example_file: undefined }) }
          : undefined}
        placeholder={'{ "value": … }'}
      />
    </>
  );

  return (
    <FourSteps
      comesIn={comesIn}
      comesInHint="What arrives at this block, and one example of it: what its code is written against and tried on."
      comesOut={<p className="text-xs" style={{ color: MUTED }}>{builder.shows}</p>}
      comesOutHint="Fixed by the kind of block: there is nothing to choose."
      task={{ field: <TaskField generation={generation} fields={fields} onSurface /> }}
      body={{
        title: 'Code',
        hint: 'Empty, the block shows what arrives as it is -- all it needs when that already is what step 2 says.',
        content: (
          <>
            <GeneratedBody
              generation={generation}
              fields={fields}
              generating={generating}
              message={message}
              onGenerate={onGenerate}
              title={widget.label || builder.label}
              preview={steps.preview}
              sent={steps.sent}
            />
            <TryItInline
              of={blockTryKey(widget, example)}
              canRun={!problem}
              whyNot="The example in step 1 is not an object yet."
              run={() => steps.tryIt(example ?? { value: null })}
              renderResult={steps.renderResult}
            />
            {steps.openInEditor}
          </>
        ),
      }}
    />
  );
}
