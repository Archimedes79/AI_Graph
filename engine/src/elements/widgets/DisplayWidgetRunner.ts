import type { Port } from '../../graph.ts';
import type { SnippetFailure } from '../ElementRunner.ts';
import { WidgetRunner, type Widget } from '../WidgetRunner.ts';

/**
 * A widget that only shows something: one input port, no output.
 *
 * Nothing downstream depends on it, so a failure in its transform is cosmetic —
 * it becomes the displayed value instead of taking the whole node down, which
 * is what it used to do to every sibling widget.
 */
export abstract class DisplayWidgetRunner<C = unknown> extends WidgetRunner<C> {
  ports(widget: Widget): { inputs: Port[]; outputs: Port[] } {
    return {
      inputs: [{
        id: `${widget.id}_in`,
        name: widget.label || widget.id,
        kind: 'input',
        data_type: 'any',
        // Multi: several sources can feed one display, and the executor then
        // collects them as a list. A single-valued port would take the last
        // edge and drop the rest without saying so.
        multi: true,
        required: false,
        description: '',
      }],
      outputs: [],
    };
  }

  override readonly snippetFailure: SnippetFailure = 'cosmetic';

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }
}
