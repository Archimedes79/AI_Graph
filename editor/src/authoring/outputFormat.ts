import type { GraphNode } from '@/graph';

/**
 * The declared output format as a sentence for the model, or nothing when the
 * node emits plain text. Both ai and code generation want it, which is why it
 * is here rather than in either element.
 *
 * A module of its own, depending on nothing but the graph's types, because an
 * element's `…GuiBuilder.ts` imports it: anything that reached the element registry
 * from here would make a cycle, and the element read first would be missing
 * from `NODE_BUILDERS`.
 */
export function outputFormatContext(config: GraphNode['config']): string {
  if (!config.output_format || config.output_format === 'text') return '';
  if (config.output_format === 'example') {
    // An answer kept from a test run: the shape is shown rather than described.
    return config.output_example
      ? `The output must have the same structure as this example:\n${config.output_example}`
      : '';
  }
  const custom = config.output_format === 'custom' && config.output_format_prompt
    ? ` (${config.output_format_prompt})`
    : '';
  return `The function must return output in ${config.output_format} format${custom}.`;
}
