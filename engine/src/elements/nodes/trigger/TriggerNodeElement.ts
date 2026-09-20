import { NodeElement } from '../../NodeElement.ts';
import type { Runtime } from '../../Runtime.ts';
import type { GraphNode } from '../../../graph.ts';
import { port } from '../../port.ts';
import type { Problem } from '../../../execution/wiring.ts';
import { parseInterval, TRIGGER_PORT } from '../../../execution/triggers.ts';

export interface TriggerConfig {
  /** Fire once when the tool starts, without waiting to be asked. */
  onStart: boolean;
  /** Fire again this often: `45`, `30s`, `5m`, `2h`, `1d`. Empty means never. */
  every: string;
}

/**
 * What starts a graph when nobody is there to press anything: the tool
 * starting, and a clock.
 *
 * It used to be two fields in the graph's settings, which started *everything*
 * and could be seen nowhere on the canvas. As a node it is an event like a
 * button's: one boolean output, true in the round it started, wired to the
 * nodes -- or their ◆ -- that it should start. Wired to nothing it starts the
 * whole graph, which is what a lone button does too, and what the two settings
 * meant.
 *
 * Whoever holds the graph keeps the time (`host/schedule.ts`); this only says
 * when. In a run nobody's event started it counts as having fired, like every
 * other event.
 */
export class TriggerNodeElement extends NodeElement<TriggerConfig> {
  readonly nodeType = 'trigger' as const;

  config(node: GraphNode): TriggerConfig {
    return {
      onStart: node.config.trigger_on_start !== false,
      every: String(node.config.trigger_every ?? '').trim(),
    };
  }

  override derivedPorts() {
    return {
      inputs: [],
      outputs: [port(TRIGGER_PORT, 'Fired', 'output', 'boolean', false, 'True in the round this trigger started, false in any other')],
    };
  }

  override eventPorts(): string[] {
    return [TRIGGER_PORT];
  }

  /** It keeps time when it names an interval: what a graph inside a node cannot do. */
  override keepsTime(node: GraphNode): boolean {
    return this.config(node).every !== '';
  }

  override problems(node: GraphNode, _elements: unknown, where: string): Problem[] {
    const { onStart, every } = this.config(node);
    if (every) {
      try {
        parseInterval(every);
      } catch (error) {
        return [{ where, problem: error instanceof Error ? error.message : String(error), fix: 'Write the interval as 45, 30s, 5m, 2h or 1d.' }];
      }
    }
    if (!onStart && !every) {
      return [{ where, problem: 'This trigger never fires: it is set neither to start with the tool nor to repeat.', fix: 'Tick "when the tool starts", give it an interval, or delete it.' }];
    }
    return [];
  }

  async execute(_node: GraphNode, _inputs: Record<string, unknown>, runtime: Runtime) {
    return { [TRIGGER_PORT]: runtime.fired?.(TRIGGER_PORT) ?? true };
  }
}
