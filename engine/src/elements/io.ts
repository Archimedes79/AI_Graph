import { NodeElement, type Runtime } from '../element.js';
import type { GraphNode } from '../graph.js';

export interface InputConfig {
  value: string;
  mode: 'text' | 'file' | 'directory';
  recursive: boolean;
  extensions: string;
  selectAll: boolean;
  selectorCode: string;
  promptAtRuntime: boolean;
}

/**
 * A value from outside the graph: typed text, one file, or a folder listing.
 *
 * The directory case is the same behaviour the file-picker block has one level
 * down, and it runs the same way — an authored selector narrowing a listing.
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
      promptAtRuntime: c.prompt_at_runtime === true,
    };
  }

  async execute(node: GraphNode, _inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    if (settings.mode === 'text') return { output: settings.value };
    if (!settings.value) return { output: settings.mode === 'directory' ? [] : null };
    if (settings.mode === 'file') return { output: runtime.files.resolve(settings.value) };

    const extensions = settings.extensions
      .split(',').map((e) => e.trim()).filter(Boolean)
      .map((e) => (e.startsWith('.') ? e : `.${e}`));
    let files = await runtime.files.list(settings.value, {
      recursive: settings.recursive,
      extensions: extensions.length ? extensions : undefined,
    });

    if (!settings.selectAll && settings.selectorCode.trim()) {
      const chosen = await this.runSnippet(node, { files }, runtime, settings.selectorCode);
      if (Array.isArray(chosen.files)) files = chosen.files.map(String);
    }
    return { output: files };
  }
}

export interface OutputConfig {
  /** Where to write, when writing to disk. */
  path: string;
  mode: 'none' | 'file' | 'directory';
  /** What this output is called in the run's result. */
  label: string;
}

/**
 * What the graph produces: a value in the result, and optionally a file.
 *
 * It does not *show* anything. Showing is what the page is for, and an output
 * node that opened a window of its own was a second place where results
 * appeared — with its own layout, its own idea of formatting, and no relation
 * to the interface being designed next door.
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
    };
  }

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime) {
    const settings = this.config(node);
    const value = inputs.value;
    const path = String(inputs.path ?? '') || settings.path;

    if (settings.mode !== 'none' && path) {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      await runtime.files.write(runtime.files.resolve(path), text);
    }
    return { value };
  }
}
