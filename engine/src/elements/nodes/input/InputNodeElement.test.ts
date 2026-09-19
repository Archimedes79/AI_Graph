import { describe, it, expect } from 'vitest';
import { InputNodeElement } from './InputNodeElement.ts';
import type { Runtime } from '../../Runtime.ts';
import type { GraphNode } from '../../../graph.ts';

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
    const element = new InputNodeElement();
    const ports = element.derivedPorts(inputNode({ input_mode: 'file', value: '/x' }));
    expect(ports?.outputs.map((p) => p.id)).not.toContain('error');
  });

  it('is declared for file and directory modes when catch_errors is on, not for text', () => {
    const element = new InputNodeElement();
    expect(element.derivedPorts(inputNode({ input_mode: 'file', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'directory', catch_errors: true }))?.outputs.map((p) => p.id))
      .toContain('error');
    expect(element.derivedPorts(inputNode({ input_mode: 'text', catch_errors: true }))?.outputs.map((p) => p.id))
      .not.toContain('error');
  });
});

describe('where it reads', () => {
  const reads: Runtime = {
    ...broken,
    files: { ...broken.files, read: async (path: string) => `contents of ${path}` },
  };

  it('takes the wired path over the configured one, as the port promises', async () => {
    const element = new InputNodeElement();
    const result = await element.execute(
      inputNode({ input_mode: 'file', value: '/configured.txt' }),
      { path: '/wired.txt' },
      reads,
    );
    expect(result).toEqual({ content: 'contents of /wired.txt', path: '/wired.txt' });
  });

  it('falls back to the configured path when the wire brought nothing', async () => {
    const element = new InputNodeElement();
    for (const arrived of [{}, { path: '' }, { path: '   ' }, { path: null }]) {
      const result = await element.execute(inputNode({ input_mode: 'file', value: '/configured.txt' }), arrived, reads);
      expect(result).toMatchObject({ path: '/configured.txt' });
    }
  });
});

describe('a file that cannot be read', () => {
  // It throws either way; the executor decides what that costs. See executor.test.ts.
  it('throws, whatever catch_errors says', async () => {
    const element = new InputNodeElement();
    await expect(element.execute(inputNode({ input_mode: 'file', value: '/gone.txt' }), {}, broken))
      .rejects.toThrow('ENOENT');
    await expect(element.execute(inputNode({ input_mode: 'file', value: '/gone.txt', catch_errors: true }), {}, broken))
      .rejects.toThrow('ENOENT');
  });

  it('reports an empty error alongside a real read', async () => {
    const element = new InputNodeElement();
    const okay: Runtime = { ...broken, files: { ...broken.files, resolve: (p) => p, read: async () => 'hi' } };
    const result = await element.execute(inputNode({ input_mode: 'file', value: '/x.txt', catch_errors: true }), {}, okay);
    expect(result).toEqual({ content: 'hi', path: '/x.txt', error: '' });
  });
});
