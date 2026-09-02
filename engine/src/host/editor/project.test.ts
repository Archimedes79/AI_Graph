import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Authored, FileChanged, apply, authoredItems, defaultFileName, forgetAll, load, nodeDir, parse, render, save, slug,
} from './project.ts';
import { parseGraph, type Graph } from '../../graph.ts';

/**
 * A project is a graph plus one file per authored node.
 *
 * The first half is the file format -- what a header says, what flows back --
 * and the second is the editor's Open/Save against a real folder: the file is
 * written beside the graph, the JSON stops repeating the code, a rename
 * renames the file, and an edit made outside is never silently overwritten.
 */

beforeEach(forgetAll);

function graph(nodes: Record<string, unknown>[]): Graph {
  return parseGraph({ metadata: { name: 'g' }, nodes, edges: [] });
}

function codeNode(config: Record<string, unknown> = {}, label = 'Analyse'): Record<string, unknown> {
  return {
    id: 'n1', node_type: 'code', label,
    inputs: [{ id: 'text', name: 'Text', kind: 'input', data_type: 'text', multi: false, required: false, description: '' }],
    outputs: [{ id: 'result', name: 'Out', kind: 'output', data_type: 'any', multi: false, required: false, description: '' }],
    config,
  };
}

function item(config: Record<string, unknown> = {}, node = codeNode(config)) {
  const g = graph([node]);
  return { graph: g, item: authoredItems(g, '/x')[0].item };
}

describe('names', () => {
  it('names the file after the element', () => {
    expect(defaultFileName('Analyse', '.js')).toBe('Analyse.js');
    expect(defaultFileName('Analyse', '.md')).toBe('Analyse.md');
  });

  it('still yields a name from a label a filesystem would reject', () => {
    expect(slug('Was / ist: das?')).toBe('Was_ist_das');
    expect(slug('')).toBe('node');
  });

  it('keeps two elements with the same label apart', () => {
    expect(defaultFileName('Analyse', '.js', ['Analyse.js'])).toBe('Analyse_2.js');
    expect(defaultFileName('analyse', '.js', ['Analyse.js', 'Analyse_2.js'])).toBe('analyse_3.js');
  });

  it('puts the files in a folder named after the graph', () => {
    expect(nodeDir('/p/my_graph.json')).toBe(join('/p', 'my_graph.nodes'));
  });
});

describe('the file', () => {
  it('fences the header in comments for code, and in front matter for prose', () => {
    const code = render(item({ code: 'function run(i) { return {}; }', code_prompt: 'Die Absicht.' }).item, 'Analyse.js');
    expect(code.startsWith('// --- ai-graph ---')).toBe(true);
    expect(code).toContain('// node:    Analyse');
    expect(code).toContain('// prompt: |\n//   Die Absicht.');
    expect(code).toContain('// inputs:  text');

    const prose = render(item({ system_prompt: 'You are careful.' }, { ...codeNode(), node_type: 'ai', description: 'Ask' }).item, 'Ask.md');
    expect(prose.startsWith('---\n')).toBe(true);
    expect(prose).toContain('\nprompt: |\n  Ask\n');
  });

  it('round-trips: render, parse, apply, unchanged', () => {
    const { item: it_ } = item({ code: 'def run(i):\n    return {}', code_prompt: 'Die Absicht.' });
    const { header, body } = parse(render(it_, 'Analyse.js'), 'Analyse.js');
    it_.body = ''; it_.prompt = '';
    apply(it_, header, body);
    expect(it_.body).toBe('def run(i):\n    return {}');
    expect(it_.prompt).toBe('Die Absicht.');
    expect(header.id).toBe('n1');
  });

  it('lets the label, prompt and context file flow back, but never the id or the ports', () => {
    const { item: it_ } = item({ code: 'x' });
    apply(it_, { node: 'Renamed', prompt: 'p', 'context-file': '/a.csv', id: 'other', inputs: 'nope' }, 'y');
    expect(it_.label).toBe('Renamed');
    expect(it_.prompt).toBe('p');
    expect(it_.contextFile).toBe('/a.csv');
    expect(it_.ident).toBe('n1');
    expect(it_.inputs).toEqual(['text']);
  });

  it('treats a file without a header as all body', () => {
    expect(parse('function run(i) { return {}; }', 'x.js')).toEqual({ header: {}, body: 'function run(i) { return {}; }' });
  });

  it('writes the skeleton for empty code, and never over a written body or into prose', () => {
    expect(render(item({}).item, 'Analyse.js')).toContain('function run(inputs) {');
    expect(render(item({ code: 'function run() {}' }).item, 'Analyse.js')).not.toContain('@typedef');
    expect(render(item({ system_prompt: '' }, { ...codeNode(), node_type: 'ai' }).item, 'Ask.md')).not.toContain('function run');
  });

  it('is the same code for a block inside a page', () => {
    const g = graph([{
      id: 'g1', node_type: 'gui', label: 'Page', inputs: [], outputs: [],
      config: { gui_widgets: [{ id: 'w1', kind: 'plot_window', label: 'Verlauf', code: 'c', code_prompt: 'p' }] },
    }]);
    const [{ folder, item: block }] = authoredItems(g, '/x');
    expect(folder).toBe(join('/x', 'Page'));
    expect(block).toBeInstanceOf(Authored);
    expect(render(block, 'Verlauf.js')).toContain('// inputs:  w1_in');
  });
});

describe('open and save', () => {
  async function project() {
    const dir = await mkdtemp(join(tmpdir(), 'project-'));
    return { dir, path: join(dir, 'g.json') };
  }
  const withFile = (code = 'function run() { return { result: 1 }; }') =>
    graph([codeNode({ code, code_prompt: 'p', code_file: 'x.js' })]);

  it('writes the node file beside the graph, and the JSON does not repeat the code', async () => {
    const { dir, path } = await project();
    await save(path, withFile());
    const file = join(dir, 'g.nodes', 'Analyse.js');
    expect(await readFile(file, 'utf8')).toContain('return { result: 1 }');
    const json = JSON.parse(await readFile(path, 'utf8'));
    expect(json.nodes[0].config.code).toBe('');
    expect(json.nodes[0].config.code_file).toBe('Analyse.js');
    expect(json.metadata.updated_at).toBeTruthy();
  });

  it('fills the code back in from the file on load', async () => {
    const { path } = await project();
    await save(path, withFile());
    const loaded = await load(path);
    expect(loaded.nodes[0].config.code).toContain('return { result: 1 }');
  });

  it('renames the file when the node is renamed', async () => {
    const { dir, path } = await project();
    await save(path, withFile());
    const renamed = withFile();
    renamed.nodes[0].label = 'Prüfung';
    renamed.nodes[0].config.code_file = 'Analyse.js';
    await save(path, renamed);
    expect(existsSync(join(dir, 'g.nodes', 'Prüfung.js'))).toBe(true);
    expect(existsSync(join(dir, 'g.nodes', 'Analyse.js'))).toBe(false);
  });

  it('does not blank a node whose file is missing, nor touch one without a file', async () => {
    const { path } = await project();
    await writeFile(path, JSON.stringify({
      metadata: { name: 'g' }, edges: [],
      nodes: [codeNode({ code: 'kept', code_file: 'gone.js' }), { ...codeNode({ code: 'inline' }), id: 'n2' }],
    }));
    const loaded = await load(path);
    expect(loaded.nodes[0].config.code).toBe('kept');
    expect(loaded.nodes[1].config.code).toBe('inline');
  });

  it('refuses to save over an edit made outside, and takes it after a reload', async () => {
    const { dir, path } = await project();
    await save(path, withFile());
    const file = join(dir, 'g.nodes', 'Analyse.js');
    await writeFile(file, '// --- ai-graph ---------\n// node: Analyse\n// id: n1\n// ------------------------\n\nfunction run() { return { result: 2 }; }\n');
    // Same second, different size is enough; nudge the clock anyway so mtime differs too.
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));

    await expect(save(path, withFile())).rejects.toBeInstanceOf(FileChanged);

    const reloaded = await load(path);
    expect(reloaded.nodes[0].config.code).toContain('result: 2');
    await expect(save(path, reloaded)).resolves.toBeTruthy();
  });

  it('says what is wrong with a path that is not a graph', async () => {
    const { path } = await project();
    await expect(load(path)).rejects.toThrow(/not found/i);
    await writeFile(path, '{ not json');
    await expect(load(path)).rejects.toThrow(/Invalid graph JSON/);
  });
});
