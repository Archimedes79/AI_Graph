import { describe, it, expect } from 'vitest';
import type { FileService } from '../elements/Runtime.ts';
import { readPorts } from './fileInputs.ts';

const files: FileService = {
  resolve: (path) => path, exists: async () => true, write: async () => {}, list: async () => [],
  read: async (path) => { if (!path) throw new Error("ENOENT: no such file or directory, open ''"); return `content of ${path}`; },
};

describe('reading wired files into their content', () => {
  it('reads a path, and every path of a list, on the ports that carry paths -- and leaves the rest alone', async () => {
    const read = await readPorts({ one: 'a.txt', many: ['b.txt', 'c.txt'], other: 'd.txt' }, ['one', 'many'], files);
    expect(read).toEqual({ one: 'content of a.txt', many: ['content of b.txt', 'content of c.txt'], other: 'd.txt' });
  });

  it('takes no path for no file: a picker nobody has used hands on "", and the node is there to say so', async () => {
    // It used to fail with `ENOENT: open ''` before the node ran at all.
    expect(await readPorts({ one: '', many: ['', 'b.txt'], blank: '   ' }, ['one', 'many', 'blank'], files))
      .toEqual({ one: '', many: ['', 'content of b.txt'], blank: '' });
  });
});
