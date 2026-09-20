import type { Port } from '../../graph.ts';
import { WidgetRunner } from '../WidgetRunner.ts';

/**
 * A widget that is part of the page rather than part of the graph: a heading, a
 * rule, a gap. No ports, and nothing to run.
 *
 * An interface built only from inputs and outputs cannot be laid out — there
 * was no way to write a title. These are what make a gui node a document rather
 * than a stack of labelled boxes.
 */
export abstract class StaticWidgetRunner<C = unknown> extends WidgetRunner<C> {
  ports(): { inputs: Port[]; outputs: Port[] } {
    return { inputs: [], outputs: [] };
  }

  async execute(): Promise<Record<string, unknown>> {
    return {};
  }
}
