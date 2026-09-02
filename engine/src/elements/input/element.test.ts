import { describe, it, expect } from 'vitest';
import { InputElement } from './element.ts';
import type { Runtime } from '../../element.ts';
import type { GraphNode } from '../../graph.ts';

/**
 * A read that fails: a missing file, an unreadable folder.
 *
 * Off by default, the node fails the way it always did. On, the failure
 * becomes an `error` port instead -- declared only then, so a graph that never
 * asked for one is not handed a port nobody wired.
 */

function inputNode(config: Record<string, unknown>): GraphNode {
  return {
    id: 'src', node_type: 'input', label: 'Source', description: '',
    position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  };
}

const broken: Runtime = {
  files: {
    resolve: (p) => p,
    exists: async () => false,
    read: async () => { throw new Error('ENOENT: no such file'); },
    write: async () => {},
    list: async () => { throw new Error('ENOENT: no such directory'); },
  },
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

describe('an error port', () => {
  it('is not declared when catch_errors is off', () => {
    const element = new InputElement();
    const ports = element.derivedPorts(inputNode({ input_mode: 'file', value: '/x' }));
    expect(ports?.outputs.map((p) => p.id)).not.toContain('error');
  });

  it('is declared for file and directory modes when catch_errors is on, not for text', () => {
    const element = new InputElement();
    expect(element.derivedPorts(inputNode({ input_mode: 'file', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'directory', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'text', catch_errors: true }))?.outputs.map((p) => p.id))
      .not.toContain('error');
  });
});

describe('a file that cannot be read', () => {
  it('still throws when catch_errors is off', async () => {
    const element = new InputElement();
    await expect(element.execute(inputNode({ input_mode: 'file', value: '/gone.txt' }), {}, broken))
      .rejects.toThrow('ENOENT');
  });

  it('reports the reason on the error port when catch_errors is on', async () => {
    const element = new InputElement();
    const result = await element.execute(inputNode({ input_mode: 'file', value: '/gone.txt', catch_errors: true }), {}, broken);
    expect(result).toEqual({ content: '', path: '', error: 'ENOENT: no such file' });
  });

  it('reports an empty error alongside a real read', async () => {
    const element = new InputElement();
    const okay: Runtime = { ...broken, files: { ...broken.files, resolve: (p) => p, read: async () => 'hi' } };
    const result = await element.execute(inputNode({ input_mode: 'file', value: '/x.txt', catch_errors: true }), {}, okay);
    expect(result).toEqual({ content: 'hi', path: '/x.txt', error: '' });
  });
});

describe('a directory that cannot be listed', () => {
  it('reports the reason on the error port when catch_errors is on', async () => {
    const element = new InputElement();
    const result = await element.execute(
      inputNode({ input_mode: 'directory', value: '/nope', catch_errors: true }), {}, broken,
    );
    expect(result).toEqual({ files: [], count: 0, error: 'ENOENT: no such directory' });
  });
});
