import type { Port } from '../../graph.ts';
import { WidgetRunner, type Widget } from '../WidgetRunner.ts';

/**
 * A block that only shows something: one input port, no output -- a chart, a
 * table, an image. It draws what arrives and runs no code of its own: shaping
 * a value into what a block can draw is a code node's work, wired in before it.
 */
export abstract class DisplayWidgetRunner extends WidgetRunner<Record<string, never>> {
  /** Nothing to set: what it shows is what arrives. */
  config(): Record<string, never> {
    return {};
  }

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

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }

  // ── Build time ────────────────────────────────────────────────────────────

  /**
   * What this kind draws, in words: what a node wired into it should hand
   * it, and what the block's own dialog says it shows. Lower case, to follow
   * "should be".
   */
  abstract draws(): string;

  /** What a node wired into it should hand it: what it draws. */
  override receives(): string {
    return this.draws();
  }

  /** What arrives: said once for the three drawing kinds. */
  override graphAuthorNote(): string {
    return `shows what arrives on "<id>_in", which should be ${this.draws()}`;
  }
}
