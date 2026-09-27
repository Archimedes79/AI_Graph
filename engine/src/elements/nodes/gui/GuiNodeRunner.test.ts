import { describe, it, expect } from 'vitest';
import { GuiNodeRunner, parseWidget } from './GuiNodeRunner.ts';
import type { Runtime } from '../../Runtime.ts';
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

/**
 * What a display block shows, as a run and its ▶ Test both ask it.
 *
 * The body is a stand-in here: what it returns (or throws) is decided by the
 * test, so what is checked is what the block makes of that.
 */
describe('what a block with a transform shows', () => {
  const answering = (answer: (body: string) => Record<string, unknown>): Runtime => ({
    ...brokenFolder,
    files: { ...brokenFolder.files, resolve: (p) => `/project/${p}` },
    code: { run: async (body) => answer(body) },
  });
  const block = (kind: string, code: string) => parseWidget({ id: 'img', kind, label: 'Cover', code });

  it('shows a failing image transform\'s own message -- it was loaded as a path and garbled', async () => {
    const failing = answering(() => { throw new Error('no cover field'); });
    const shown = await new GuiNodeRunner().showBlock(block('image_view', 'function run() {}'), { title: 'x' }, failing);
    expect(shown).toMatch(/^⚠ img: transform failed:/);
    expect(shown).toContain('no cover field');
    expect(shown).not.toContain('Not a recognised image file');
  });

  it('says so when a transform returned no "value", instead of showing the input untouched', async () => {
    const shown = await new GuiNodeRunner().showBlock(block('table', 'function run() {}'), [{ a: 1 }], answering(() => ({ rows: [] })));
    expect(shown).toBe('⚠ img: its transform returned no "value" (only "rows").');
    const nothing = await new GuiNodeRunner().showBlock(block('table', 'function run() {}'), [{ a: 1 }], answering(() => ({})));
    expect(nothing).toBe('⚠ img: its transform returned no "value".');
  });

  it('shows the null a transform returned, since that is what it said to show', async () => {
    const shown = await new GuiNodeRunner().showBlock(block('table', 'function run() {}'), [{ a: 1 }], answering(() => ({ value: null })));
    expect(shown).toBeNull();
  });

  it('still hands a block without a transform what arrived', async () => {
    const shown = await new GuiNodeRunner().showBlock(block('table', ''), [{ a: 1 }], answering(() => { throw new Error('must not run'); }));
    expect(shown).toEqual([{ a: 1 }]);
  });
});
