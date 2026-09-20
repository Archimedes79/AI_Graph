// A node's examples: what it is given, and what must come out.
//
// Optional, and written by a person (or taken from a run) in the node's own
// `examples.md`. They do not change how a body is written -- ✨ Generate works
// as it did -- they check what was written, whoever wrote it: `check` looks at
// whether they still fit the wiring, `test` runs them.
//
//     ## Counts only data rows
//     ```json input
//     { "input": "Country,Population\nIndia,1450000000" }
//     ```
//     ```json expect
//     { "output": 1 }
//     ```
//
// An expectation names only what it cares about: the fields it lists must be
// there with those values, anything else the node returns is its own business.
// A model's answer is never the same twice, so for an AI node the expectation
// can instead be a sentence, and a model judges whether the answer meets it:
//
//     ```judge
//     Two sentences, and no judgement of the story.
//     ```

import type { Graph } from '../graph.ts';
import type { Runtime } from '../elements/Runtime.ts';
import type { Registry } from './executor.ts';
import { executeNode, withGraphDefaults } from './executor.ts';
import { mismatches } from './interface.ts';

export interface NodeExample {
  title: string;
  inputs: Record<string, unknown>;
  /** The outputs that must match: a subset of what the node returns. */
  expect?: Record<string, unknown>;
  /** A sentence a model holds the answer to, for outputs that are never the same twice. */
  judge?: string;
}

const BLOCK = /```([^\n`]*)\n([\s\S]*?)```/g;

/**
 * The examples in *text*, and what is wrong with the ones that cannot be read.
 * Lenient about everything else: prose between the blocks is for people.
 */
export function parseExamples(text: string): { examples: NodeExample[]; problems: string[] } {
  const examples: NodeExample[] = [];
  const problems: string[] = [];
  const sections = text.replace(/\r\n/g, '\n').split(/^## +/m).slice(1);
  for (const section of sections) {
    const title = section.split('\n', 1)[0].trim() || `Example ${examples.length + 1}`;
    const example: NodeExample = { title, inputs: {} };
    let hasInput = false;
    for (const [, info, body] of section.matchAll(BLOCK)) {
      const words = info.trim().toLowerCase().split(/\s+/);
      const role = words.includes('input') ? 'input' : words.includes('expect') ? 'expect' : words.includes('judge') ? 'judge' : '';
      if (role === 'judge') {
        example.judge = body.trim();
        continue;
      }
      if (!role) continue;
      let value: unknown;
      try {
        value = JSON.parse(body);
      } catch (error) {
        problems.push(`"${title}": its ${role} block is not valid JSON: ${(error as Error).message}`);
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`"${title}": its ${role} block must be an object keyed by port, like {"input": "…"}.`);
        continue;
      }
      if (role === 'input') {
        example.inputs = value as Record<string, unknown>;
        hasInput = true;
      } else {
        example.expect = value as Record<string, unknown>;
      }
    }
    if (!hasInput) problems.push(`"${title}": no \`\`\`json input block.`);
    if (!example.expect && !example.judge) problems.push(`"${title}": no \`\`\`json expect or \`\`\`judge block, so nothing is checked.`);
    if (hasInput && (example.expect || example.judge)) examples.push(example);
  }
  return { examples, problems };
}

/** One example, written the way `parseExamples` reads it: for "add this run as an example". */
export function formatExample(title: string, inputs: Record<string, unknown>, expect: Record<string, unknown>): string {
  return `## ${title}\n\n\`\`\`json input\n${JSON.stringify(inputs, null, 2)}\n\`\`\`\n\n\`\`\`json expect\n${JSON.stringify(expect, null, 2)}\n\`\`\`\n`;
}

/**
 * Where *actual* falls short of *expected*, as sentences naming the place.
 * An object expects its listed keys and ignores the rest; a list expects the
 * same length and each item in turn; anything else, the same value.
 */
export function unmet(expected: unknown, actual: unknown, at = 'output', found: string[] = []): string[] {
  if (found.length >= 5) return found;
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      found.push(`${at} is ${show(actual)}; expected an object`);
      return found;
    }
    for (const [key, value] of Object.entries(expected)) {
      if (!(key in (actual as Record<string, unknown>))) found.push(`${at}.${key} is missing`);
      else unmet(value, (actual as Record<string, unknown>)[key], `${at}.${key}`, found);
    }
    return found;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) found.push(`${at} is ${show(actual)}; expected a list of ${expected.length}`);
    else if (actual.length !== expected.length) found.push(`${at} has ${actual.length} items; expected ${expected.length}`);
    else expected.forEach((item, index) => unmet(item, actual[index], `${at}[${index}]`, found));
    return found;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) found.push(`${at} is ${show(actual)}; expected ${show(expected)}`);
  return found;
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export interface ExampleResult {
  title: string;
  /** `skipped`: it needs a model and none was to be asked. */
  status: 'pass' | 'fail' | 'error' | 'skipped';
  details: string[];
  outputs?: Record<string, unknown>;
}

const JUDGE_SYSTEM = 'You check whether an answer meets a criterion. Reply with PASS or FAIL on the first line, '
  + 'then one short sentence saying why. Judge only the criterion, not style or anything else.';

/**
 * Run *nodeId*'s examples. Each runs the node alone, the way ▶ Test does,
 * on the example's inputs; nothing upstream runs.
 *
 * *offline*: nothing asks a model -- an AI node's examples and every judged
 * expectation are skipped, which is how CI runs them.
 */
export async function runExamples(
  graph: Graph,
  nodeId: string,
  options: { runtime: Runtime; registry: Registry; offline?: boolean },
): Promise<ExampleResult[]> {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return [{ title: nodeId, status: 'error', details: [`No node "${nodeId}".`] }];
  const { examples, problems } = parseExamples(String(node.config.examples ?? ''));
  const results: ExampleResult[] = problems.map((problem) => ({ title: 'examples.md', status: 'error' as const, details: [problem] }));
  const element = options.registry.node(node.node_type);
  const asksModel = element?.asksModel(node) === true;
  const runtime = withGraphDefaults(options.runtime, graph);

  for (const example of examples) {
    if (options.offline && (asksModel || (example.judge && !example.expect))) {
      results.push({ title: example.title, status: 'skipped', details: ['Needs a model, and this run asks none.'] });
      continue;
    }
    const ran = await executeNode(graph, nodeId, example.inputs, { runtime, registry: options.registry });
    if (ran.status === 'error') {
      results.push({ title: example.title, status: 'error', details: [ran.error ?? 'The node failed.'], outputs: ran.outputs });
      continue;
    }
    const details = example.expect ? unmet(example.expect, ran.outputs) : [];
    const iface = element?.outputInterface(node);
    if (iface) details.push(...mismatches(ran.outputs, iface).map((line) => `breaks its output interface: ${line}`));
    if (example.judge && !options.offline) {
      try {
        const verdict = await runtime.ai.complete({
          system: JUDGE_SYSTEM,
          prompt: `Criterion:\n${example.judge}\n\nAnswer:\n${JSON.stringify(ran.outputs, null, 2)}`,
          temperature: 0,
          ...(node.config.ai_provider ? { provider: String(node.config.ai_provider) } : {}),
          ...(node.config.ai_model ? { model: String(node.config.ai_model) } : {}),
        });
        const [first = '', ...rest] = verdict.trim().split('\n');
        if (!/^\W*PASS\b/i.test(first)) details.push(`judged: ${[first, ...rest].join(' ').replace(/^\W*FAIL\W*/i, '').trim() || 'does not meet the criterion'}`);
      } catch (error) {
        results.push({ title: example.title, status: 'error', details: [`The judge could not be asked: ${(error as Error).message}`], outputs: ran.outputs });
        continue;
      }
    }
    results.push({ title: example.title, status: details.length ? 'fail' : 'pass', details, outputs: ran.outputs });
  }
  return results;
}
