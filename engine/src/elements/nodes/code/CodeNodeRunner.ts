import { NodeRunner, type TextFile, type WhatRuns } from '../../NodeRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { Logic, logicFrom } from '../../../authoring/logic.ts';
import type { GraphNode } from '../../../graph.ts';
import type { LogicFields } from '../../../authoring/logic.ts';
import type { Generation } from '../../../authoring/generation.ts';
import { DEFINITION_TEXTS, definitionsIn, type Definitions } from '../../../authoring/definition.ts';
import type { Problem } from '../../../execution/wiring.ts';

/** What a code node stores. Its own fields, and no one else's. */
const CODE_FIELDS: LogicFields = { body: 'code' };

export interface CodeConfig {
  code: string;
}

/** code.js while there is no code: what it is, and which ✨ writes it. */
const CODE_STUB = `// code.js: what this code node does -- \`function run(inputs)\`, returning an
// object keyed by its outputs. ✨ Code writes it from the node's text, its
// input.js and its output.js.`;

/**
 * What follows the code in code.js, and only there: the folder writes it after
 * the body and takes it off again when it reads the file, so the node, the
 * sandbox and the generator never see it (and in the sandbox, whose file is
 * not code.js, it would do nothing).
 *
 * It works under both module systems -- a body that uses `import` runs as an
 * ES module, and so does any file under a package.json that says
 * `"type": "module"`, where `require` and `module` do not exist: a direct run
 * is told by the file Node was asked to run, and input.js is read as text, by
 * the rule `definitionExample` reads it with -- the same lines, so `node
 * code.js` runs on the example ▶ Try and `test` run on (folder.test.ts holds
 * the two to each other). Written raw: what is here is what the file says.
 */
export const RUN_ON_ITS_OWN = String.raw`// ── Run on its own ─────────────────────────────────────────────────────────
// "node code.js" runs this node on the example in input.js and prints what
// comes out -- the example read as ▶ Try reads it: the JSON after the last
// "module.exports =" that is code, not one a comment or a string holds. In a
// graph the engine runs this node, and this part is left out.
if (/^code(\.js)?$/.test(process.getBuiltinModule('node:path').basename(process.argv[1] ?? ''))) {
  const { dirname, join } = process.getBuiltinModule('node:path');
  const text = process.getBuiltinModule('node:fs').readFileSync(join(dirname(process.argv[1]), 'input.js'), 'utf8');
  const stringEnd = (start) => {
    for (let at = start + 1; at < text.length; at += 1) {
      if (text[at] === '\\') at += 1;
      else if (text[at] === text[start]) return at;
    }
    return text.length;
  };
  let found = -1;
  for (let at = 0; at < text.length; at += 1) {
    const two = text.slice(at, at + 2);
    if (two === '//') at = text.indexOf('\n', at) < 0 ? text.length : text.indexOf('\n', at);
    else if (two === '/*') at = text.indexOf('*/', at + 2) < 0 ? text.length : text.indexOf('*/', at + 2) + 1;
    else if ('"\'${'`'}'.includes(text[at])) at = stringEnd(at);
    else if (text.startsWith('module.exports', at) && !/[\w$.]/.test(text[at - 1] ?? '')) {
      const assigned = /^module\.exports\s*=(?!=)/.exec(text.slice(at));
      if (assigned) found = at + assigned[0].length;
    }
  }
  const valueFrom = (start) => {
    const from = text.slice(start).search(/\S/);
    if (from < 0) return '';
    const begin = start + from;
    if (text[begin] !== '{' && text[begin] !== '[') {
      const end = text.slice(begin).search(/;|\n/);
      return end < 0 ? text.slice(begin) : text.slice(begin, begin + end);
    }
    let depth = 0;
    for (let at = begin; at < text.length; at += 1) {
      if (text[at] === '"') at = stringEnd(at);
      else if (text[at] === '{' || text[at] === '[') depth += 1;
      else if ((text[at] === '}' || text[at] === ']') && (depth -= 1) === 0) return text.slice(begin, at + 1);
    }
    return text.slice(begin);
  };
  if (found < 0) throw new Error('input.js cannot be read: it has no "module.exports = { … };" with an example after it.');
  let example;
  try {
    example = JSON.parse(valueFrom(found));
  } catch (error) {
    throw new Error('input.js cannot be read: its example after module.exports is not plain JSON (' + error.message + ').');
  }
  if (example === null) throw new Error('input.js has no example yet: write it with ✨ Input.');
  if (typeof example !== 'object' || Array.isArray(example)) throw new Error('input.js cannot be read: its example after module.exports is not an object keyed by port, like { "input": … }.');
  const node = { llm: async () => { throw new Error('node.llm needs the engine: node engine/src/main.ts run-node <project> <node id>'); } };
  Promise.resolve(run(example, node)).then((out) => console.log(JSON.stringify(out, null, 2)));
}`;

/**
 * What this keeps in files of its own in a project folder (see
 * `NodeRunner.texts`), in the order a node is built: what one call is handed,
 * what it returns, the code, and every exchange with the model about it.
 */
const CODE_TEXTS: readonly TextFile[] = [
  ...DEFINITION_TEXTS,
  { field: 'code', file: 'code.js', standard: CODE_STUB, footer: RUN_ON_ITS_OWN },
  { field: 'history', file: 'history.md' },
];

/**
 * A node whose behaviour someone wrote.
 *
 * The body is `run(inputs) -> outputs`, both plain JSON objects keyed by port
 * id. JavaScript, and only JavaScript: it is the one language a recipient
 * already has once they have the engine, so a bundle asks for Node and nothing
 * else — no interpreter to find, no packages to install, no second sandbox.
 */
export class CodeNodeRunner extends NodeRunner<CodeConfig> {
  readonly nodeType = 'code' as const;

  override texts(): readonly TextFile[] {
    return CODE_TEXTS;
  }

  override definitions(node: GraphNode): Definitions {
    return definitionsIn(node);
  }

  config(node: GraphNode): CodeConfig {
    const c = node.config;
    return {
      code: String(c.code ?? ''),
    };
  }

  override logic(node: GraphNode): Logic {
    return logicFrom(node, 'code', CODE_FIELDS);
  }

  /** Its body is written for one item, so a list can be handed to it an item at a time. */
  override readonly fansOut = true;

  /** A file on an input that says so arrives as its text: `run` reads no files itself. */
  override readonly readsFileInputs = true;

  async execute(
    node: GraphNode,
    inputs: Record<string, unknown>,
    runtime: Runtime,
  ): Promise<Record<string, unknown>> {
    const logic = this.logic(node);
    if (logic.isEmpty) {
      throw new Error(`${node.label || node.id}: its code.js holds no code yet -- write it with ✨ Code.`);
    }

    // Once, for whatever it was handed. Fanning out and reading wired files
    // into their content are the executor's business (see `batchMode` and
    // `readsFileInputs`), so this stays one call.
    //
    // It may ask a model: `await node.llm({ prompt })`, answered by the
    // process that holds the keys, on the one AI setting's model.
    return logic.run(inputs, runtime);
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return 'its description says in words what it does, and config.code holds it as JavaScript: "function run(inputs) { ... }", '
      + 'returning an object whose keys are exactly this node\'s output port ids. Use only what Node has built in; there is no '
      + 'package manager. The function may be async and is handed a second argument, node: "await node.llm({ prompt: \'...\' })" '
      + 'asks the configured model a question and resolves to its answer as text -- use it when code has to decide what to ask, '
      + 'or ask in a loop; for one question, use an ai node instead. config.input_definition and config.output_definition may '
      + 'say what one call is handed and returns, each as a JSDoc typedef followed by "module.exports = <one example as plain JSON>;".';
  }

  override whatRuns(): WhatRuns {
    return { by: 'body', where: 'code.js', does: 'Calls run(inputs, node) in code.js, sandboxed, and hands on the object it returns, keyed by output port.' };
  }

  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    if (String(node.config.code ?? '').trim()) return [];
    return [{
      where,
      problem: 'Its code.js holds no code yet (config.code is empty): it fails the moment it runs.',
      fix: `Write it with ✨ Code from the node's text -- or put "function run(inputs) { ... }" in config.code, returning an object keyed by this node's output port ids.`,
    }];
  }

  /**
   * Written against the node's own ports and definitions.
   *
   * No contract of its own. It used to carry one about charts -- return the
   * data to plot, never a drawing -- and every code node was told it, including
   * the ones that feed a table or nothing at all. That sentence is true of what
   * a *chart* receives, so the chart says it now (`WidgetRunner.receives`), and
   * only a node that is wired into one hears it.
   */
  override generation(): Generation {
    return {
      kind: 'code', fields: CODE_FIELDS,
      guard: 'Say what this node should do first: its text is what the code is written from.',
      success: '✅ Code written.',
    };
  }
}
