import type { GraphNode } from '@/graph';
import { promptText } from '@engine/elements/nodes/ai/prompt.ts';
import { ownOutputs, runsPerItem } from '@/authoring/nodeStepRules';
import type { Keep } from '@/authoring/TryItInline';
import { ONCE, type NodePanelProps } from '../../NodeGuiBuilder';

/**
 * What came out of a try, as one answer, as text. A node run once per item
 * hands on a list of answers, and keeping that list told every later run to
 * answer with a JSON list of one string.
 */
export function keptAnswer(node: GraphNode, outputs: Record<string, unknown> | undefined): string {
  const own = ownOutputs(outputs);
  const values = Object.values(own);
  const answer = values.length === 1 ? values[0] : own;
  const one = runsPerItem(node) && Array.isArray(answer) ? answer[0] : answer;
  return promptText(one);
}

/** What begins the sentence an answer's shape is kept in. */
export const ANSWER_SHAPE = 'Answer in this shape:';

/**
 * *words* -- an ai node's step 2 words -- with *answer* kept as the shape to
 * answer in: "Answer in this shape: …", after whatever else the words say and
 * in place of a shape kept before. What an ai node's words say is sent with
 * every request, so this is how "Keep this answer's shape" keeps an answer a
 * person liked: an answer is never the same twice, so it is a shape to follow,
 * not an output to check -- and there is no second place for it any more
 * (`output.example.md` was one, beside the words, saying the same).
 */
export function withAnswerShape(words: string, answer: string): string {
  const at = words.indexOf(ANSWER_SHAPE);
  const rest = (at < 0 ? words : words.slice(0, at)).trimEnd();
  return [rest, `${ANSWER_SHAPE} ${answer.trim()}`].filter(Boolean).join('\n\n');
}

/**
 * An ai node's "Keep" under ▶ Try it: the answer's shape into step 2's words
 * (`withAnswerShape`), as an undo step of its own. Its button said "Keep as
 * expected output", which it is not: nothing holds a later answer to it.
 */
export function keepAnswerShape(node: GraphNode, setConfig: NodePanelProps['setConfig']): Keep {
  return {
    label: 'Keep this answer\'s shape',
    says: 'Put “Answer in this shape: …” with this answer into the words of step 2: the model is sent them with every request',
    onKeep: (result) => setConfig(
      'output_format_prompt', (current: unknown) => withAnswerShape(String(current ?? ''), keptAnswer(node, result.outputs)), ONCE,
    ),
  };
}
