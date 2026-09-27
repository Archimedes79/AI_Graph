import { NodeRunner } from '../../NodeRunner.ts';
import type { TextFile, WhatRuns } from '../../ElementRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { type GraphNode, type Port } from '../../../graph.ts';
import { logicFrom, Logic } from '../../../authoring/logic.ts';
import { selectFiles } from '../../fileSelection.ts';
import { port } from '../../port.ts';
import { errorOutput } from '../../../execution/wiring.ts';
import { SELECTOR_FIELDS, SELECTOR_GENERATION } from '../../../authoring/generation.ts';
import type { Generation } from '../../../authoring/generation.ts';

export interface InputConfig {
  value: string;
  mode: 'text' | 'file' | 'directory';
  recursive: boolean;
  extensions: string;
  selectAll: boolean;
  promptAtRuntime: boolean;
  /** Return a failed read or listing as an `error` port instead of failing the node. */
  catchErrors: boolean;
}

/** What a port holds, in words: one of them, and a list of them. */
const HOLDS: Record<string, [string, string]> = {
  text: ['text', 'texts'], number: ['a number', 'numbers'], file_path: ['a file path', 'file paths'],
};

/** A port for the graph designer: `"count" (a number, how many files were listed)`. */
function portInWords(port: Port): string {
  const [one, many] = HOLDS[port.data_type] ?? [port.data_type, port.data_type];
  const what = port.description ? `, ${port.description.charAt(0).toLowerCase()}${port.description.slice(1)}` : '';
  return `"${port.id}" (${port.multi ? `a list of ${many}` : one}${what})`;
}

/** What this keeps in files of its own in a project folder: see `ElementRunner.texts`. */
/** The body that chooses files: named once, so what is said about it names the file that exists. */
const SELECTOR_FILE = 'select.js';
/**
 * The selector the editor used to give every new input node, in every mode. It
 * handed on every file, which an empty selector does too, so it is nobody's
 * writing: a project still holding it reads as holding none, and its next save
 * writes no `select.js` for it.
 */
const EARLIER_STARTER = 'function run(inputs) {\n  // inputs.files is the full list of file paths in the directory\n  return { files: inputs.files ?? [] };\n}\n';
const SELECTOR_TEXTS: readonly TextFile[] = [
  { field: 'selector_code', file: SELECTOR_FILE, standard: '', earlier: [EARLIER_STARTER] },
  { field: 'selector_prompt', file: 'task.md' },
];

/**
 * A value from outside the graph: typed text, one file, or a folder listing.
 *
 * Its ports depend on the mode, and so does what it emits — text puts one value
 * on `output`, a file puts `content` and `path`, a directory puts `files` and
 * `count`. That is the node's declared contract, not a convention: an element
 * emits the ports its node says it has, which is the thing a second engine gets
 * wrong first if it invents names of its own.
 */
export class InputNodeRunner extends NodeRunner<InputConfig> {
  readonly nodeType = 'input' as const;

  /**
   * Only a folder listing keeps a selector in its folder, as `logic` says.
   * A text or single-file input selects nothing, and a `select.js` beside it
   * said that it did: its selector stays in the graph with its other settings.
   *
   * Except while the graph holds none of it. A save from before this kept the
   * selector in its files whatever the mode, and took it out of the graph, so
   * a node switched away from listing a folder may hold the selector somebody
   * wrote for it only there. It is read in from those files, and the next save
   * keeps it in the graph and tidies the files away. Asked of a node holding
   * nothing -- which is how a save learns what it may tidy -- the names are
   * the same as ever.
   */
  override texts(node: GraphNode): readonly TextFile[] {
    if (this.config(node).mode === 'directory') return SELECTOR_TEXTS;
    const holdsSome = SELECTOR_TEXTS.some((text) => node.config[text.field] !== undefined);
    return holdsSome ? [] : SELECTOR_TEXTS;
  }

  config(node: GraphNode): InputConfig {
    const c = node.config;
    const mode = String(c.input_mode ?? 'text');
    return {
      value: String(c.value ?? ''),
      mode: (['text', 'file', 'directory'].includes(mode) ? mode : 'text') as InputConfig['mode'],
      recursive: c.recursive === true,
      extensions: String(c.extensions ?? ''),
      selectAll: c.select_all_files !== false,
      promptAtRuntime: c.prompt_at_runtime === true,
      catchErrors: c.catch_errors === true,
    };
  }

  /**
   * A text input is a value handed in: from the node above when this graph is
   * one, and from whoever runs it otherwise. A file or directory input reads
   * something instead -- to say from outside *which* file, wire a port to its
   * `path` input.
   */
  override boundaryRole(node: GraphNode): 'in' | null {
    return this.config(node).mode === 'text' ? 'in' : null;
  }

  override derivedPorts(node: GraphNode) {
    const settings = this.config(node);
    const { mode } = settings;
    const path = port('path', 'Path', 'input', 'file_path', false, 'Override the configured path');
    // A missing or unreadable file is the one thing here that can fail at run
    // time; text mode has nothing to read and so nothing to catch.
    const error = settings.catchErrors && mode !== 'text'
      ? [errorOutput('Set when the read failed; empty otherwise')]
      : [];

    if (mode === 'text') {
      return { inputs: [], outputs: [port('output', 'Output', 'output', 'text')] };
    }
    if (mode === 'directory') {
      return {
        inputs: [path],
        outputs: [
          port('files', 'Files', 'output', 'file_path', true, 'Rooted file paths'),
          port('count', 'Count', 'output', 'number', false, 'How many files were listed'),
          ...error,
        ],
      };
    }
    return {
      inputs: [path],
      outputs: [
        port('content', 'Content', 'output', 'text'),
        port('path', 'Path', 'output', 'file_path', false, 'Always includes the root'),
        ...error,
      ],
    };
  }

  /** Only a folder listing is authored: a text or single-file input selects nothing. */
  override logic(node: GraphNode): Logic | undefined {
    if (this.config(node).mode !== 'directory') return undefined;
    return logicFrom(node, 'code', SELECTOR_FIELDS);
  }

  override runtimeRequirements(node: GraphNode) {
    const settings = this.config(node);
    if (!settings.promptAtRuntime) return [];
    return [{
      key: node.id,
      label: node.label || node.id,
      kind: settings.mode,
      direction: 'input' as const,
      current: settings.value,
    }];
  }

  override applyRuntimeValue(node: GraphNode, _widgetId: string | null, value: string): void {
    node.config.value = value;
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);

    // Text mode has no inputs to read: what it hands on is what it holds. A
    // graph above answers it without running it (`given`), and a value asked
    // for when the run starts is put where it holds its text.
    if (settings.mode === 'text') return { output: settings.value };

    // The wired path wins over the configured one -- what the port promises
    // ("Override the configured path") and what the output node has always
    // done with its own `path`. It used to be the other way round, so a node
    // told at run time where to read went on reading what it was set up with,
    // and the wire looked like it had done nothing. A wire that brought
    // nothing is nothing, and leaves the configured path standing.
    const raw = String(inputs.path ?? '').trim() || settings.value;
    const blank = settings.mode === 'file' ? { content: '', path: '' } : { files: [], count: 0 };
    // An empty path is not a failure -- nothing was asked for -- so the error
    // port, when there is one, says so by staying empty.
    if (!raw) return { ...blank, ...(settings.catchErrors ? { error: '' } : {}) };

    // A read that throws is caught by the executor, which fills the port this
    // element declared just below.
    if (settings.mode === 'file') {
      const path = runtime.files.resolve(raw);
      const content = await runtime.files.read(path);
      return { content, path, ...(settings.catchErrors ? { error: '' } : {}) };
    }
    const files = await selectFiles(this.logic(node), settings, raw, runtime);
    return { files, count: files.length, ...(settings.catchErrors ? { error: '' } : {}) };
  }

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * Its settings, and the ports each mode derives, said from `derivedPorts`
   * itself: a hand-kept list of them once named the count without saying it
   * is a number, and a graph built on it added "3" to "4".
   */
  override graphAuthorNote(): string {
    const modes = (['text', 'file', 'directory'] as const).map((mode) => {
      const { inputs, outputs } = this.derivedPorts({ id: 'i', config: { input_mode: mode } } as unknown as GraphNode);
      const taken = inputs.length ? `; input ${inputs.map(portInWords).join(' and ')}` : '';
      return `  - input_mode "${mode}": outputs ${outputs.map(portInWords).join(' and ')}${taken}.`;
    });
    return 'config.value is the text, the file path or the folder path; config.input_mode is text, file or directory. '
      + `Its ports are DERIVED from input_mode, not taken from this document:\n${modes.join('\n')}`;
  }

  override whatRuns(node: GraphNode): WhatRuns {
    const { mode, selectAll } = this.config(node);
    if (mode === 'file') return this.engineRuns('Reads the file whose path arrives on "path" (or the one it names) and hands on its text as "content".');
    if (mode === 'directory') {
      return this.engineRuns('Lists the folder whose path arrives on "path" (or the one it names) and hands on the files as "files"'
        + (!selectAll && this.logic(node)?.isEmpty === false ? `, chosen by ${SELECTOR_FILE}, which runs sandboxed.` : '.'));
    }
    return this.engineRuns('Hands on the text it holds, or what the person running the graph was asked for.');
  }

  override referencedPaths(node: GraphNode): string[] {
    const settings = this.config(node);
    return settings.mode !== 'text' && settings.value ? [settings.value] : [];
  }

  /** Literally the object the file-picker block returns: one behaviour, two levels. */
  override generation(): Generation {
    return SELECTOR_GENERATION;
  }
}
