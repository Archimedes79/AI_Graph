import { GraphNodeElement, type Runtime } from '../../element.ts';
import { type GraphNode } from '../../graph.ts';

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
export class OutputElement extends GraphNodeElement<OutputConfig> {
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
