import type { GraphNode } from '@/graph';
import { promptText } from '@engine/elements/nodes/ai/prompt.ts';
import { ownOutputs, runsPerItem } from '@/authoring/nodeStepRules';

/**
 * What came out of a try, as the answer a model is shown to imitate: one
 * answer, as text. A node run once per item hands on a list of answers, and
 * keeping that list told every later run to answer with a JSON list of one
 * string.
 *
 * The ai node's own: an answer is never the same twice, so what its step 2
 * keeps is a style to imitate (`output_example`), not an output to check.
 */
export function keptAnswer(node: GraphNode, outputs: Record<string, unknown> | undefined): string {
  const own = ownOutputs(outputs);
  const values = Object.values(own);
  const answer = values.length === 1 ? values[0] : own;
  const one = runsPerItem(node) && Array.isArray(answer) ? answer[0] : answer;
  return promptText(one);
}
