import { NodeRunner } from '../../NodeRunner.ts';
import type { WhatRuns } from '../../ElementRunner.ts';
import { type Runtime } from '../../Runtime.ts';
import { type GraphNode, type Port } from '../../../graph.ts';

/**
 * The input that says *where* to write rather than *what*: a control input,
 * and the one port of an output node that is not part of its value.
 */
const WRITE_PATH_PORT = 'path';

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
export class OutputNodeRunner extends NodeRunner<OutputConfig> {
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

  /** Everything a graph produces leaves through one of these. */
  override readonly isResult = true;

  override resultLabel(node: GraphNode): string {
    return this.config(node).label;
  }

  override boundaryRole(): 'out' {
    return 'out';
  }

  override valuePorts(node: GraphNode): Port[] {
    return node.inputs.filter((port) => port.id !== WRITE_PATH_PORT);
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

  async execute(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime): Promise<Record<string, unknown>> {
    const paths = inputs[WRITE_PATH_PORT];
    if (Array.isArray(paths) && this.config(node).mode !== 'none') return this.writeToEach(node, inputs, paths, runtime);
    return this.writeOnce(node, inputs, runtime);
  }

  /**
   * A list of paths wired in, with "list" ticked on `path`: the first value to
   * the first path, the second to the second. An output node no longer runs
   * once per item, and a file per computed name is the one thing that did for
   * it -- kept for the graphs that were built on it.
   */
  private async writeToEach(node: GraphNode, inputs: Record<string, unknown>, paths: unknown[], runtime: Runtime): Promise<Record<string, unknown>> {
    const lists = new Set(node.inputs.filter((port) => port.multi && port.id !== WRITE_PATH_PORT).map((port) => port.id));
    const written: unknown[] = [];
    for (const [index, path] of paths.entries()) {
      const item: Record<string, unknown> = { [WRITE_PATH_PORT]: path };
      for (const [key, value] of Object.entries(inputs)) {
        if (key !== WRITE_PATH_PORT) item[key] = lists.has(key) && Array.isArray(value) ? value[index] ?? null : value;
      }
      const result = await this.writeOnce(node, item, runtime);
      if (result.written_path !== undefined) written.push(result.written_path);
      if (Array.isArray(result.written_paths)) written.push(...result.written_paths);
    }
    const values: Record<string, unknown> = { ...inputs };
    delete values[WRITE_PATH_PORT];
    return { ...values, written_paths: written };
  }

  private async writeOnce(node: GraphNode, inputs: Record<string, unknown>, runtime: Runtime): Promise<Record<string, unknown>> {
    const settings = this.config(node);
    // A wired `path` sets the target at run time and always wins over the
    // configured one; it is a control input, not a value to report back.
    const target = inputs[WRITE_PATH_PORT] ? runtime.files.resolve(String(inputs[WRITE_PATH_PORT])) : settings.path;
    const values: Record<string, unknown> = { ...inputs };
    delete values[WRITE_PATH_PORT];

    const result: Record<string, unknown> = { ...values };
    if (settings.mode === 'file' && target) {
      const present = Object.values(values).filter((v) => v !== null && v !== undefined);
      const content = present.length === 1 && typeof present[0] === 'string'
        ? present[0]
        : present.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
      await runtime.files.write(target, content);
      result.written_path = target;
    } else if (settings.mode === 'directory' && target) {
      result.written_paths = await writeEach(target, values, runtime);
    }
    return result;
  }

  // ── Build time ────────────────────────────────────────────────────────────

  override graphAuthorNote(): string {
    return `config.write_mode is none, window, file or directory: window shows the result in a window in the editor, `
      + `file writes it to the file config.value names, directory writes each value to a file of its own in the folder config.value names. `
      + `config.output_label names the result in the run's result and titles the window; give every output node its own.`;
  }

  override whatRuns(node: GraphNode): WhatRuns {
    const { mode } = this.config(node);
    if (mode === 'file') return this.engineRuns('Writes what arrives to its file and hands it on, with "written_path".');
    if (mode === 'directory') {
      return this.engineRuns('Writes each value that arrives -- each item of a list -- to a file of its own in its folder, and hands it on, with "written_paths".');
    }
    return this.engineRuns('Hands on what arrives: the run\'s result, shown in a window or returned to whoever ran the graph.');
  }
}

/**
 * Write every value to a file of its own in *folder*, and say which files.
 *
 * A list is what a node run once per item hands on -- a summary per file of a
 * folder -- so each item is a value of its own and gets a file of its own,
 * numbered by its place in the list: the third file is the third item's even
 * when the second failed and left a null, which writes nothing. Numbers are
 * padded to the length of the list so the files sort in its order. Text is
 * written as it is, as `.txt`; anything else as the JSON it is, as `.json`.
 */
async function writeEach(folder: string, values: Record<string, unknown>, runtime: Runtime): Promise<string[]> {
  const written: string[] = [];
  for (const [portId, value] of Object.entries(values)) {
    const items = Array.isArray(value) ? value : [value];
    const width = String(items.length).length;
    for (const [index, item] of items.entries()) {
      if (item === null || item === undefined) continue;
      const name = Array.isArray(value) ? `${portId}_${String(index + 1).padStart(width, '0')}` : portId;
      const text = typeof item === 'string';
      const path = inFolder(folder, `${name}.${text ? 'txt' : 'json'}`);
      await runtime.files.write(path, text ? item : JSON.stringify(item, null, 2));
      written.push(path);
    }
  }
  return written;
}

/**
 * *name* inside *folder*, in the separator the folder is already written in.
 * Spelled out rather than taken from `node:path`: an element also runs in the
 * editor's browser tab, where there is no such module.
 */
function inFolder(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
}
