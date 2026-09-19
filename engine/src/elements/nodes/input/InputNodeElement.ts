import { NodeElement } from '../../NodeElement.ts';
import type { TextFile } from '../../Element.ts';
import { type Runtime } from '../../Runtime.ts';
import { type GraphNode } from '../../../graph.ts';
import { logicFrom, Logic } from '../../../authoring/logic.ts';
import { selectFiles } from '../../fileSelection.ts';
import { port } from '../../port.ts';
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

/** What this keeps in files of its own in a project folder: see `Element.texts`. */
const SELECTOR_TEXTS: readonly TextFile[] = [
  { field: 'selector_code', file: 'select.js' },
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
export class InputNodeElement extends NodeElement<InputConfig> {
  override texts(): readonly TextFile[] {
    return SELECTOR_TEXTS;
  }

  readonly nodeType = 'input' as const;

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

  override referencedPaths(node: GraphNode): string[] {
    const settings = this.config(node);
    return settings.mode !== 'text' && settings.value ? [settings.value] : [];
  }

  override derivedPorts(node: GraphNode) {
    const settings = this.config(node);
    const { mode } = settings;
    const path = port('path', 'Path', 'input', 'file_path', false, 'Override the configured path');
    // A missing or unreadable file is the one thing here that can fail at run
    // time; text mode has nothing to read and so nothing to catch.
    const error = settings.catchErrors && mode !== 'text'
      ? [port('error', 'Error', 'output', 'text', false, 'Set when the read failed; empty otherwise')]
      : [];

    if (mode === 'text') {
      return { inputs: [], outputs: [port('output', 'Output', 'output', 'text')] };
    }
    if (mode === 'directory') {
      return {
        inputs: [path],
        outputs: [
          port('files', 'Files', 'output', 'file_path', true, 'Rooted file paths'),
          port('count', 'Count', 'output', 'text'),
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

  /** Literally the object the file-picker block returns: one behaviour, two levels. */
  override generation(): Generation {
    return SELECTOR_GENERATION;
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

    if (settings.mode === 'text') {
      return { output: settings.value || inputs.value || inputs.path || '' };
    }

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
}
