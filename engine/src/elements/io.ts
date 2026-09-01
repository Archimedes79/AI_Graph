import { NodeElement, type AuthoredFile, type Runtime } from '../element.ts';
import type { GraphNode } from '../graph.ts';
import { port } from './port.ts';

export interface InputConfig {
  value: string;
  mode: 'text' | 'file' | 'directory';
  recursive: boolean;
  extensions: string;
  selectAll: boolean;
  selectorCode: string;
  language: string;
  promptAtRuntime: boolean;
}

/**
 * A value from outside the graph: typed text, one file, or a folder listing.
 *
 * Its ports depend on the mode, and so does what it emits — text puts one value
 * on `output`, a file puts `content` and `path`, a directory puts `files` and
 * `count`. That is the node's declared contract, not a convention: an element
 * emits the ports its node says it has, which is the thing a second engine gets
 * wrong first if it invents names of its own.
 */
export class InputElement extends NodeElement<InputConfig> {
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
      selectorCode: String(c.selector_code ?? ''),
      language: String(c.language ?? 'javascript'),
      promptAtRuntime: c.prompt_at_runtime === true,
    };
  }

  override derivedPorts(node: GraphNode) {
    const { mode } = this.config(node);
    const path = port('path', 'Path', 'input', 'file_path', false, 'Override the configured path');

    if (mode === 'text') {
      return { inputs: [], outputs: [port('output', 'Output', 'output', 'text')] };
    }
    if (mode === 'directory') {
      return {
        inputs: [path],
        outputs: [
          port('files', 'Files', 'output', 'file_path', true, 'Rooted file paths'),
          port('count', 'Count', 'output', 'text'),
        ],
      };
    }
    return {
      inputs: [path],
      outputs: [
        port('content', 'Content', 'output', 'text'),
        port('path', 'Path', 'output', 'file_path', false, 'Always includes the root'),
      ],
    };
  }

  /** Only a folder listing is authored: a text or single-file input selects nothing. */
  override authoredFile(node: GraphNode): AuthoredFile | undefined {
    if (this.config(node).mode !== 'directory') return undefined;
    return {
      bodyField: 'selector_code',
      nameField: 'code_file',
      extension: this.config(node).language.startsWith('py') ? '.py' : '.js',
      what: 'this file selector',
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

    if (settings.mode === 'text') {
      return { output: settings.value || inputs.value || inputs.path || '' };
    }

    const raw = settings.value || String(inputs.path ?? '');
    if (!raw) {
      return settings.mode === 'file' ? { content: '', path: '' } : { files: [], count: 0 };
    }

    if (settings.mode === 'file') {
      const path = runtime.files.resolve(raw);
      return { content: await runtime.files.read(path), path };
    }

    const files = await selectFiles(this, node, settings, raw, runtime);
    return { files, count: files.length };
  }
}

/**
 * List a folder, then let an authored selector narrow it.
 *
 * The same behaviour the file-picker block runs one level down, through this
 * same function — one contract at two levels, implemented once, which is what
 * stops the two from drifting apart the first time either is changed.
 */
export async function selectFiles(
  element: { runSnippet: (subject: never, inputs: Record<string, unknown>, runtime: Runtime, body?: string) => Promise<Record<string, unknown>> },
  subject: unknown,
  settings: { recursive: boolean; extensions: string; selectAll: boolean; selectorCode: string },
  path: string,
  runtime: Runtime,
): Promise<string[]> {
  const extensions = settings.extensions
    .split(',').map((e) => e.trim()).filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`));

  let files = await runtime.files.list(path, {
    recursive: settings.recursive,
    extensions: extensions.length ? extensions : undefined,
  });

  if (!settings.selectAll && settings.selectorCode.trim()) {
    const chosen = await element.runSnippet(subject as never, { files }, runtime, settings.selectorCode);
    if (Array.isArray(chosen.files)) files = chosen.files.map(String);
  }
  return files;
}

export interface OutputConfig {
  /** Where to write, when writing at all. */
  path: string;
  mode: 'none' | 'file' | 'directory';
  /** What this output is called in the run's result. */
  label: string;
  promptAtRuntime: boolean;
}

/**
 * What the graph produces: everything wired into it, plus a file if asked.
 *
 * A passthrough, deliberately — it echoes its inputs so the run's result says
 * what arrived, rather than inventing a shape of its own. It does not *show*
 * anything either: showing is what the page is for, and an output node that
 * opened a window was a second place where results appeared, with its own
 * layout and no relation to the interface being designed next door.
 */
export class OutputElement extends NodeElement<OutputConfig> {
  readonly nodeType = 'output' as const;

  config(node: GraphNode): OutputConfig {
    const c = node.config;
    const mode = String(c.write_mode ?? 'none');
    return {
      path: String(c.value ?? ''),
      mode: (['none', 'file', 'directory'].includes(mode) ? mode : 'none') as OutputConfig['mode'],
      label: String(c.output_label ?? '') || node.id,
      promptAtRuntime: c.prompt_at_runtime === true,
    };
  }

  override runtimeRequirements(node: GraphNode) {
    const settings = this.config(node);
    if (!settings.promptAtRuntime || settings.mode === 'none') return [];
    return [{
      key: node.id,
      label: node.label || node.id,
      kind: settings.mode,
      direction: 'output' as const,
      current: settings.path,
    }];
  }

  override applyRuntimeValue(node: GraphNode, _widgetId: string | null, value: string): void {
    node.config.value = value;
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    // A wired `path` sets the target at run time and always wins over the
    // configured one; it is a control input, not a value to report back.
    const target = inputs.path ? runtime.files.resolve(String(inputs.path)) : settings.path;
    const values: Record<string, unknown> = { ...inputs };
    delete values.path;

    const result: Record<string, unknown> = { ...values };
    if (settings.mode === 'file' && target) {
      const present = Object.values(values).filter((v) => v !== null && v !== undefined);
      const content = present.length === 1 && typeof present[0] === 'string'
        ? present[0]
        : present.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
      await runtime.files.write(target, content);
      result.written_path = target;
    }
    return result;
  }
}
