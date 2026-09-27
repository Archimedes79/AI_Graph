import { describe, it, expect } from 'vitest';
import { PlotWindowWidgetRunner } from './PlotWindowWidgetRunner.ts';
import { GuiNodeRunner, parseWidget } from '../../nodes/gui/GuiNodeRunner.ts';
import { parseGraph } from '../../../graph.ts';
import { quietRuntime } from '../../../../test/fakes.ts';

/**
 * A chart draws what arrives: a figure or points, which the page draws at the
 * block's real size, or a string of SVG. It has no code of its own; a code
 * node before it shapes what it is handed.
 */
const element = new PlotWindowWidgetRunner();

describe('a chart, from the engine', () => {
  it('says what it takes, for the node wired into it and for the graph designer alike', () => {
    const block = parseWidget({ id: 'c', kind: 'plot_window' });
    for (const said of [element.receives(), element.graphAuthorNote()]) {
      expect(said).toContain('{"label": string, "value": number}');
      expect(said).toContain('"kind": "bars"|"columns"|"line"|"donut"');
      expect(said).toContain('<svg');
    }
    expect(element.config()).toEqual({});
    expect(element.ports(block)).toEqual({ inputs: [expect.objectContaining({ id: 'c_in', multi: true })], outputs: [] });
  });

  it('is shown what arrived, untouched, and runs no code', async () => {
    const page = parseGraph({
      nodes: [{ id: 'page', node_type: 'gui', config: { gui_widgets: [{ id: 'chart', kind: 'plot_window' }] } }],
    }).nodes[0];
    const figure = { kind: 'line', title: 'T', points: [{ label: 'a', value: 1 }] };
    const refusing = quietRuntime({ code: { run: async () => { throw new Error('no body runs for a block'); } } });
    await expect(new GuiNodeRunner().display(page, { chart_in: figure }, refusing)).resolves.toEqual({ chart: figure });
  });
});
