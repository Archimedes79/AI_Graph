import { describe, it, expect } from 'vitest';
import { GuiElement } from './element.ts';
import type { Runtime } from '../../element.ts';
import type { GraphNode } from '../../graph.ts';

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
const brokenFolder: Runtime = {
  files: {
    resolve: (p) => p,
    exists: async () => false,
    read: async () => '',
    write: async () => {},
    list: async () => { throw new Error('ENOENT: no such directory'); },
  },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

describe('a block that fails', () => {
  it('takes the whole page down when nobody asked otherwise', async () => {
    const element = new GuiElement();
    await expect(element.execute(page([picker(), box]), {}, brokenFolder)).rejects.toThrow('ENOENT');
  });

  it('costs only itself once it is told to catch', async () => {
    const element = new GuiElement();
    const produced = await element.execute(page([picker({ catch_errors: true }), box]), {}, brokenFolder);

    expect(produced.pick_out).toBeNull();
    expect(produced.pick_error).toBe('ENOENT: no such directory');
    // The block that had nothing to do with the folder still produced.
    expect(produced.note_out).toBe('still here');
  });

  it('grows the port only when asked, and reports an empty reason when it worked', async () => {
    const element = new GuiElement();
    const ports = (widget: Record<string, unknown>) =>
      element.derivedPorts(page([widget])).outputs.map((p) => p.id);

    expect(ports(picker())).not.toContain('pick_error');
    expect(ports(picker({ catch_errors: true }))).toContain('pick_error');

    const working: Runtime = { ...brokenFolder, files: { ...brokenFolder.files, list: async () => ['/a.csv'] } };
    const produced = await element.execute(page([picker({ catch_errors: true })]), {}, working);
    expect(produced.pick_error).toBe('');
  });
});
