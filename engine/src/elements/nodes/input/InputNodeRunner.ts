import { NodeRunner } from '../../NodeRunner.ts';
import type { WhatRuns } from '../../ElementRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { type GraphNode, type Port } from '../../../graph.ts';
import { listFolder } from '../../folderListing.ts';
import { port } from '../../port.ts';
import { errorOutput } from '../../../execution/wiring.ts';

export interface InputConfig {
  value: string;
  mode: 'text' | 'file' | 'directory';
  recursive: boolean;
  extensions: string;
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

/**
 * A value from outside the graph: typed text, one file, or a folder listing.
 *
 * Its ports depend on the mode, and so does what it emits — text puts one value
 * on `output`, a file puts `content` and `path`, a directory puts `files` and
 * `count`. That is the node's declared contract, not a convention: an element
 * emits the ports its node says it has, which is the thing a second engine gets
 * wrong first if it invents names of its own.
 *
 * A listing is the folder, its file types and its subfolders, and nothing
 * else: keeping only some of the files is a code node after it.
 */
export class InputNodeRunner extends NodeRunner<InputConfig> {
  readonly nodeType = 'input' as const;

  config(node: GraphNode): InputConfig {
    const c = node.config;
    const mode = String(c.input_mode ?? 'text');
    return {
      value: String(c.value ?? ''),
      mode: (['text', 'file', 'directory'].includes(mode) ? mode : 'text') as InputConfig['mode'],
      recursive: c.recursive === true,
      extensions: String(c.extensions ?? ''),
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
    const files = await listFolder(raw, settings, runtime);
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
      + 'A directory lists every file in the folder: config.extensions (e.g. ".csv, .txt") keeps only those types, '
      + 'config.recursive = true looks into subfolders too; to keep only some of the files, wire a code node after it. '
      + `Its ports are DERIVED from input_mode, not taken from this document:\n${modes.join('\n')}`;
  }

  override whatRuns(node: GraphNode): WhatRuns {
    const { mode } = this.config(node);
    if (mode === 'file') return this.engineRuns('Reads the file whose path arrives on "path" (or the one it names) and hands on its text as "content".');
    if (mode === 'directory') {
      return this.engineRuns('Lists the folder whose path arrives on "path" (or the one it names) -- its file types, and its subfolders when it looks into them -- and hands on the files as "files".');
    }
    return this.engineRuns('Hands on the text it holds, or what the person running the graph was asked for.');
  }

  override referencedPaths(node: GraphNode): string[] {
    const settings = this.config(node);
    return settings.mode !== 'text' && settings.value ? [settings.value] : [];
  }
}
