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

/**
 * code.js while there is no code: what it is, and which ✨ writes it -- and,
 * run on its own (`node code.js`), a line that says so and a failing exit
 * code, where a file of comments printed nothing and "succeeded". The folder
 * reads the stub as it wrote it, as no code (`standard`).
 */
const CODE_STUB = `// code.js: what this code node does -- \`function run(inputs)\`, returning an
// object keyed by its outputs. ✨ Code writes it from the node's text, its
// input.js and its output.js.
console.error('code.js holds no code yet: write it with ✨ Code.');
process.exitCode = 1;`;

/**
 * What follows the code in code.js, and only there: the folder writes it after
 * the body and takes it off again when it reads the file, so the node, the
 * sandbox and the generator never see it (and in the sandbox, whose file is
 * not code.js, it would do nothing).
 *
 * It works under both module systems -- a body that uses `import` runs as an
 * ES module, and so does any file under a package.json that says
 * `"type": "module"`, where `require` and `module` do not exist: a direct run
 * is told by the file Node was asked to run, and input.js is run apart, in a
 * context of its own (`node:vm`) that gives it the `module` it assigns. A few
 * lines a person can read at the end of every code.js, rather than a parser:
 * the engine reads input.js without running it (`definitionExample`), and for
 * the plain JSON it holds both come to the same example.
 */
export const RUN_ON_ITS_OWN = `// ── Run on its own ─────────────────────────────────────────────────────────
// "node code.js" runs this node on the example in input.js and prints what
// comes out. In a graph the engine runs this node, and this part is left out.
if (/^code(\\.js)?$/.test(process.getBuiltinModule('node:path').basename(process.argv[1] ?? ''))) {
  const input = { exports: null };
  const file = process.getBuiltinModule('node:path').join(process.argv[1], '..', 'input.js');
  process.getBuiltinModule('node:vm').runInNewContext(process.getBuiltinModule('node:fs').readFileSync(file, 'utf8'), { module: input });
  const example = input.exports;
  if (!example || typeof example !== 'object' || Array.isArray(example)) throw new Error('input.js has no example yet -- an object keyed by input, written by ✨ Input.');
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
    // Said as a person meets it -- the file -- and the field only where a graph file is what is read.
    return [{
      where,
      problem: 'Its code.js holds no code yet: it fails the moment it runs.',
      fix: 'Write it with ✨ Code, or write function run(inputs) { … } in code.js (config.code in a graph file), returning an object keyed by its outputs.',
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
