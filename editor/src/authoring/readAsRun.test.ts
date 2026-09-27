import { describe, it, expect, vi } from 'vitest';
import type { GraphNode, GuiWidget } from '@/graph';
import { WIDGET_BUILDERS } from '@/elements/registry';
import { NODE_KINDS } from '@/document/nodeKinds';

// What a listing would post, caught instead of posted, and what the engine answers.
const posted: { route: string; body: Record<string, unknown> }[] = [];
let answer: Record<string, unknown> = { status: 'success', outputs: {}, error: null };
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  call: vi.fn(async (route: string, body: Record<string, unknown>) => {
    posted.push({ route, body });
    return answer;
  }),
}));

const { listAsRun, listBlockAsRun, readFileAsRun } = await import('./readAsRun');

describe('a file read as a run reads it', () => {
  it('is read by a node that reads the file on its input: an input node reads none', async () => {
    answer = { status: 'success', outputs: { text: 'name,age\nAda,36' }, error: null };
    expect(await readFileAsRun('data/people.csv')).toBe('name,age\nAda,36');
    const sent = posted[posted.length - 1];
    expect(sent.route).toBe('runNode');
    const [reader] = sent.body.nodes as GraphNode[];
    expect(reader.node_type).toBe('code');
    expect(reader.inputs.map((port) => [port.id, port.data_type])).toEqual([['file', 'file_path']]);
    expect(sent.body.inputs).toEqual({ file: 'data/people.csv' });
  });
});

describe('a folder listed as a run lists it', () => {
  it('hands back what a folder picker hands on, run on a page of its own', async () => {
    answer = { status: 'success', outputs: { pick_out: ['a.csv', 'b.csv'] }, error: null };
    const picker = { ...WIDGET_BUILDERS.input_picker.create('Source', 'directory'), id: 'pick', value: 'data' } as GuiWidget;
    expect(await listBlockAsRun(picker)).toEqual(['a.csv', 'b.csv']);
  });

  it('hands back what an input node hands on as its files', async () => {
    answer = { status: 'success', outputs: { files: ['x.txt'], count: 1 }, error: null };
    const node = { ...NODE_KINDS.input.create('in'), config: { ...NODE_KINDS.input.create('in').config, input_mode: 'directory', value: 'data' } } as GraphNode;
    expect(await listAsRun(node)).toEqual(['x.txt']);
  });

  it('says a failure rather than catching it, even where the block catches its failures in a run', async () => {
    // A folder picker told to catch listed a folder that does not exist as "0 files".
    answer = { status: 'error', outputs: {}, error: 'ENOENT: no such directory' };
    const picker = { ...WIDGET_BUILDERS.input_picker.create('Source', 'directory'), id: 'pick', catch_errors: true } as GuiWidget;
    await expect(listBlockAsRun(picker)).rejects.toThrow('ENOENT');
    const sent = posted[posted.length - 1];
    expect(sent.route).toBe('runNode');
    const page = (sent.body.nodes as { config: { gui_widgets: GuiWidget[] }; outputs: { id: string }[] }[])[0];
    expect(page.config.gui_widgets[0].catch_errors).toBe(false);
    expect(page.outputs.map((port) => port.id)).not.toContain('pick_error');
  });
});
