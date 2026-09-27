import { describe, it, expect } from 'vitest';
import { droppedProject } from './windowDrops';

/** The engine's search, finding *paths*, and saying where it looked as `fileSearch` says it. */
const found = (...paths: string[]) => async () => ({
  paths, searched: 'D:\\work and 3 levels of folders below it, leaving out node_modules, dist, build and every name that begins with a dot',
});

describe('a folder dropped onto the window', () => {
  it('is the one project of its name the engine finds', async () => {
    expect(await droppedProject('chat', found('D:\\work\\examples\\chat'))).toBe('D:\\work\\examples\\chat');
  });

  it('is said with where it was looked for, when there is none: "under the folder" was said of a search three folders deep', async () => {
    await expect(droppedProject('chat', found())).rejects.toThrow(
      'A browser does not say where a dropped folder is, and no project called "chat" is in D:\\work and 3 levels of folders below it, '
      + 'leaving out node_modules, dist, build and every name that begins with a dot. Open it with 📂 Open.',
    );
  });

  it('is said when several have its name, with the way that always works', async () => {
    await expect(droppedProject('chat', found('a', 'b'))).rejects.toThrow('2 projects are called "chat". Open the one you mean with 📂 Open.');
  });
});
