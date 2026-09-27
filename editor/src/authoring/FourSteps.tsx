import type React from 'react';
import type { GraphNode } from '@/graph';
import Step from './Step';
import type { ElementGeneration, FieldAccess } from './generation';
import { DIMMER, FIELD, MUTED } from '@/ui/theme';

interface Props {
  /** Step 1: what comes in -- the inputs, and the one example they are tried on. */
  comesIn: React.ReactNode;
  /** Step 2: what comes out -- the outputs, and what they should hold. */
  comesOut: React.ReactNode;
  /** Step 3: what it should do, in the person's words. */
  task: { title?: string; hint?: string; field: React.ReactNode };
  /** Step 4: the body -- code, instructions, a format -- with ✨, and Try it under it. */
  body: { title: string; hint?: string; content: React.ReactNode };
}

/**
 * Building a node that authors a body, in four steps, the same for every
 * kind: what comes in, what comes out, what it should do, and how -- tried
 * right there.
 *
 * The order is the explanation. What comes in and what comes out are what the
 * graph already knows, or can find out by running; the task is what only the
 * person can say; and the body is written from all three. A dialog that asked
 * for the task first, the ports second and a sample fifth -- with six places a
 * sample could come from and five that said what should come out -- is what
 * this replaced.
 */
export default function FourSteps({ comesIn, comesOut, task, body }: Props) {
  return (
    <>
      <Step n={1} title="What comes in" hint="What arrives on each input, and one example of it: what it is tried on, written against and tested with.">
        {comesIn}
      </Step>
      <Step n={2} title="What comes out" hint="What each output hands on. The next node is written against it.">
        {comesOut}
      </Step>
      <Step n={3} title={task.title ?? 'What should it do?'} hint={task.hint ?? 'In your own words. ✨ Generate writes step 4 from this and steps 1 and 2.'}>
        {task.field}
      </Step>
      <Step n={4} title={body.title} hint={body.hint}>
        {body.content}
      </Step>
    </>
  );
}

/** Step 3's one field: the node's request, wherever it keeps it. */
export function TaskField({ generation, fields }: {
  generation: ElementGeneration<GraphNode>;
  fields: FieldAccess;
}) {
  return (
    <textarea
      className="w-full rounded-lg px-3 py-2 text-sm resize-y"
      style={{ ...FIELD, minHeight: 80 }}
      value={fields.get(generation.promptField)}
      onChange={(event) => fields.set(generation.promptField, event.target.value)}
      placeholder={generation.promptPlaceholder}
      aria-label={generation.promptLabel ?? 'What it should do'}
    />
  );
}

/**
 * "Run once per item": step 1's one question about a list, asked only when a
 * list arrives. It was two controls in two places -- a "list" box on each
 * input and "run once on the whole input array" folded away -- that only did
 * anything together.
 */
export function RunOncePerItem({ checked, onChange, subject }: { checked: boolean; onChange: (perItem: boolean) => void; subject: string }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label="Run once per item" />
        Run once per item
      </label>
      <p className="text-xs mt-0.5" style={{ color: DIMMER }}>
        {checked
          ? `A list arrives, and ${subject} runs once for each item in it; what comes out is a list of the results. An input typed “List” is handed its list whole all the same.`
          : `A list arrives, and ${subject} gets it whole, once -- for totals, summaries, merges.`}
      </p>
    </div>
  );
}
