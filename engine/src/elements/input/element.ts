import { NodeElement, type Runtime } from '../../element.ts';
import { type GraphNode } from '../../graph.ts';
import { logicFrom, Logic } from '../../logic.ts';
import { selectFiles } from '../files.ts';
import { port } from '../port.ts';
import { SELECTOR_FIELDS, SELECTOR_GENERATION } from '../../generation.ts';
import type { Generation } from '../../generation.ts';

export interface InputConfig {
  value: string;
  mode: 'text' | 'file' | 'directory';
  recursive: boolean;
  extensions: string;
  selectAll: boolean;
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
  override logic(node: GraphNode): Logic | undefined {
    if (this.config(node).mode !== 'directory') return undefined;
    return logicFrom(node, 'code', SELECTOR_FIELDS, 'this file selector');
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

    const raw = settings.value || String(inputs.path ?? '');
    if (!raw) {
      return settings.mode === 'file' ? { content: '', path: '' } : { files: [], count: 0 };
    }

    if (settings.mode === 'file') {
      const path = runtime.files.resolve(raw);
      return { content: await runtime.files.read(path), path };
    }

    const files = await selectFiles(this.logic(node), settings, raw, runtime);
    return { files, count: files.length };
  }
}
