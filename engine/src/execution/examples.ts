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
import type { Runners } from '../elements/NodeRunner.ts';
import { executeNode } from './executor.ts';
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

/** Text with no fence in it: anything but three backticks in a row. */
const UNFENCED = '(?:[^`]|`(?!``))*';

/**
 * Where an example begins: a `## ` heading -- outside a fenced block, where
 * everything before it holds whole fences only. A judge asking for "a markdown
 * heading such as ## Title" is part of its example, not the start of the next.
 * Exported with `exampleBlocks` because the editor edits the file's first
 * example in place, and it must cut the file where a run splits it.
 */
export const EXAMPLE_SECTION = new RegExp(`(?<=(?<![\\s\\S])${UNFENCED}(?:\`\`\`${UNFENCED}\`\`\`${UNFENCED})*)^## +`, 'm');

/** A fenced block of one example, by what its info words say it is, and where it stands in the section. */
export interface ExampleBlock {
  role: 'input' | 'expect' | 'judge' | '';
  start: number;
  end: number;
  body: string;
}

/** The fenced blocks of one example's section, in order. A block that is none of the three has no role and is prose. */
export function exampleBlocks(section: string): ExampleBlock[] {
  return [...section.matchAll(BLOCK)].map((match) => {
    const words = match[1].trim().toLowerCase().split(/\s+/);
    const role = words.includes('input') ? 'input' : words.includes('expect') ? 'expect' : words.includes('judge') ? 'judge' : '';
    return { role, start: match.index!, end: match.index! + match[0].length, body: match[2] };
  });
}

/**
 * The examples in *text*, and what is wrong with the ones that cannot be read.
 * Lenient about everything else: prose between the blocks is for people.
 */
export function parseExamples(text: string): { examples: NodeExample[]; problems: string[] } {
  const examples: NodeExample[] = [];
  const problems: string[] = [];
  const sections = text.replace(/\r\n/g, '\n').split(EXAMPLE_SECTION).slice(1);
  for (const section of sections) {
    const title = section.split('\n', 1)[0].trim() || `Example ${examples.length + 1}`;
    const example: NodeExample = { title, inputs: {} };
    let hasInput = false;
    for (const { role, body } of exampleBlocks(section)) {
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
  /**
   * Why the model that judges the answer could not be asked, where it could
   * not: the example is not checked (`error`), but the node ran, and what it
   * gave stands, unjudged -- a limit reached is not a body to repair.
   */
  judgeError?: string;
}

const JUDGE_SYSTEM = 'You check whether an answer meets a criterion. Reply with PASS or FAIL on the first line, '
  + 'then one short sentence saying why. Judge only the criterion, not style or anything else.';

/**
 * Run *nodeId*'s examples. Each runs the node alone, the way ▶ Try it does,
 * on the example's inputs; nothing upstream runs.
 *
 * One result per example, in the file's order -- so the first is the node
 * dialog's example, which Try it shows -- and then one for each section that
 * cannot be read.
 *
 * *offline*: nothing asks a model -- an AI node's examples and every judged
 * expectation are skipped, which is how CI runs them.
 */
export async function runExamples(
  graph: Graph,
  nodeId: string,
  options: { runtime: Runtime; registry: Runners; offline?: boolean },
): Promise<ExampleResult[]> {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return [{ title: nodeId, status: 'error', details: [`No node "${nodeId}".`] }];
  const { examples, problems } = parseExamples(String(node.config.examples ?? ''));
  const results: ExampleResult[] = [];
  const element = options.registry.node(node.node_type);
  const asksModel = element?.asksModel(node) === true;
  const { runtime } = options;

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
          ...(node.config.ai_provider ? { provider: String(node.config.ai_provider) } : {}),
          ...(node.config.ai_model ? { model: String(node.config.ai_model) } : {}),
        });
        const [first = '', ...rest] = verdict.trim().split('\n');
        if (!/^\W*PASS\b/i.test(first)) details.push(`judged: ${[first, ...rest].join(' ').replace(/^\W*FAIL\W*/i, '').trim() || 'does not meet the criterion'}`);
      } catch (error) {
        const why = (error as Error).message;
        results.push({
          title: example.title, status: 'error', details: [...details, `The judge could not be asked: ${why}`], outputs: ran.outputs, judgeError: why,
        });
        continue;
      }
    }
    results.push({ title: example.title, status: details.length ? 'fail' : 'pass', details, outputs: ran.outputs });
  }
  return [...results, ...problems.map((problem) => ({ title: 'examples.md', status: 'error' as const, details: [problem] }))];
}

/** The graph, and every graph its nodes hold, each with the way down to it (`outer ▸ `). */
export function everyGraphIn(graph: Graph, registry: Runners, inside = ''): { graph: Graph; inside: string }[] {
  return [
    { graph, inside },
    ...graph.nodes.flatMap((node) => {
      const held = registry.node(node.node_type)?.nestedGraph(node);
      return held ? everyGraphIn(held, registry, `${inside}${node.id} ▸ `) : [];
    }),
  ];
}

/** One example's result, and the node it belongs to, with the way down to it. */
export interface TestedExample { inside: string; nodeId: string; result: ExampleResult }

/**
 * Run the examples of every node that keeps some, or only of the nodes with
 * the id *only* -- at every depth, because the graph a node holds is part of
 * the same project, as `check` also says. The one runner behind `test` on the
 * command line and `test_graph` over MCP: the second once looked at the top
 * graph only, and skipped every example inside a node without a word.
 * `tested` counts the nodes whose examples ran; none means nothing matched.
 */
export async function testGraph(
  graph: Graph,
  options: { runtime: () => Runtime; registry: Runners; offline?: boolean; only?: string },
): Promise<{ tested: number; results: TestedExample[] }> {
  const results: TestedExample[] = [];
  let tested = 0;
  for (const { graph: level, inside } of everyGraphIn(graph, options.registry)) {
    const nodes = level.nodes.filter((node) => (options.only ? node.id === options.only : String(node.config.examples ?? '').trim()));
    tested += nodes.length;
    for (const node of nodes) {
      const ran = await runExamples(level, node.id, { runtime: options.runtime(), registry: options.registry, offline: options.offline });
      results.push(...ran.map((result) => ({ inside, nodeId: node.id, result })));
    }
  }
  return { tested, results };
}
