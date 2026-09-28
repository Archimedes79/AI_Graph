import { describe, it, expect } from 'vitest';
import { GuiNodeRunner } from './GuiNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
import { registry } from '../../registry.ts';
import { startEvents } from '../../../execution/triggers.ts';
import { graphOf, quietRuntime } from '../../../../test/fakes.ts';
import type { GraphNode } from '../../../graph.ts';

/**
 * One block's failure used to cost the whole page.
 *
 * A picker aimed at a folder that has moved threw, the gui node threw with it,
 * and every other block on the page lost its output too -- a text box that had
 * nothing to do with the folder included. Told to catch, the block pays for
 * itself: its own ports go empty, its reason lands on its own port, and the
 * rest of the page still runs.
 */

function page(widgets: Record<string, unknown>[]): GraphNode {
  return {
    id: 'page', node_type: 'gui', label: 'Page', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [],
    config: { gui_widgets: widgets },
  };
}

const picker = (extra: Record<string, unknown> = {}) => ({
  id: 'pick', kind: 'input_picker', label: 'Source', mode: 'directory', value: '/gone', ...extra,
});
const box = { id: 'note', kind: 'text_io', label: 'Note', mode: 'input', value: 'still here' };

/** A machine where listing a folder fails, as it does when the folder has moved. */
const brokenFolder = quietRuntime({
  files: { exists: async () => false, list: async () => { throw new Error('ENOENT: no such directory'); } },
});

describe('a block that fails', () => {
  it('takes the whole page down when nobody asked otherwise', async () => {
    const element = new GuiNodeRunner();
    await expect(element.execute(page([picker(), box]), {}, brokenFolder)).rejects.toThrow('ENOENT');
  });

  it('costs only itself once it is told to catch', async () => {
    const element = new GuiNodeRunner();
    const produced = await element.execute(page([picker({ catch_errors: true }), box]), {}, brokenFolder);

    expect(produced.pick_out).toBeNull();
    expect(produced.pick_error).toBe('ENOENT: no such directory');
    // The block that had nothing to do with the folder still produced.
    expect(produced.note_out).toBe('still here');
  });

  it('grows the port only when asked, and reports an empty reason when it worked', async () => {
    const element = new GuiNodeRunner();
    const ports = (widget: Record<string, unknown>) =>
      element.derivedPorts(page([widget])).outputs.map((p) => p.id);

    expect(ports(picker())).not.toContain('pick_error');
    expect(ports(picker({ catch_errors: true }))).toContain('pick_error');

    const working: Runtime = { ...brokenFolder, files: { ...brokenFolder.files, list: async () => ['/a.csv'] } };
    const produced = await element.execute(page([picker({ catch_errors: true })]), {}, working);
    expect(produced.pick_error).toBe('');
  });

  it('grows no error port on a block that only shows, which never fails in a run', async () => {
    // A text box switched to "Output" kept its flag and its port, which the
    // editor no longer offered to untick, and every run sent `{}` on it.
    const element = new GuiNodeRunner();
    const shown = { ...box, mode: 'output', catch_errors: true };
    expect(element.derivedPorts(page([shown])).outputs.map((p) => p.id)).toEqual([]);
    expect(await element.execute(page([shown]), {}, brokenFolder)).toEqual({});
  });
});

/** What each display block on a page shows, once everything has arrived. */
describe('what a display block shows', () => {
  const noBody: Runtime = quietRuntime({
    files: { resolve: (p) => `/project/${p}`, read: async (p) => `bytes of ${p}` },
    code: { run: async () => { throw new Error('a block runs no code'); } },
  });
  const blocks = page([
    { id: 'rows', kind: 'table', label: 'Rows' },
    { id: 'img', kind: 'image_view', label: 'Cover' },
    { id: 'chart', kind: 'plot_window', label: 'Chart' },
  ]);

  it('is what arrived, with an image\'s path read into the picture', async () => {
    const shown = await new GuiNodeRunner().display(blocks, { rows_in: [{ a: 1 }], img_in: 'cover.png', chart_in: null }, noBody);
    expect(shown).toEqual({ rows: [{ a: 1 }], img: 'data:image/png;base64,bytes of /project/cover.png', chart: null });
  });

  it('leaves out a block nothing arrived at, so the rest of the page stays as it was', async () => {
    expect(await new GuiNodeRunner().display(blocks, { rows_in: [] }, noBody)).toEqual({ rows: [] });
  });

  it('shows a failure that arrives at an image as it is, not read as a path', async () => {
    const shown = await new GuiNodeRunner().display(blocks, { img_in: '⚠ upstream: no cover field' }, noBody);
    expect(shown).toEqual({ img: '⚠ upstream: no cover field' });
  });
});

describe('what a page starts', () => {
  it('is nothing on a block that hands nothing on, whatever it was told', () => {
    // A chart ticked "using this starts the graph" claimed an event port it
    // does not have, and the application waited for the page to start it.
    const shows = page([
      { id: 'chart', kind: 'plot_window', run_on_change: true },
      { id: 'said', kind: 'text_io', mode: 'output', run_on_change: true },
      { id: 'q', kind: 'text_io', mode: 'input' },
    ]);
    const element = new GuiNodeRunner();
    expect(element.derivedPorts(shows).outputs.map((p) => p.id)).toEqual(['q_out']);
    expect(element.eventPorts(shows)).toEqual([]);
    expect(startEvents(graphOf([shows]), registry)).toEqual([null]);
  });

  it('is the port of each block that does', () => {
    const starts = page([{ id: 'go', kind: 'button' }, { id: 'q', kind: 'text_io', mode: 'input', run_on_change: true }]);
    expect(new GuiNodeRunner().eventPorts(starts)).toEqual(['go_out', 'q_out']);
  });
});
