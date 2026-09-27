import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExampleInputField from './ExampleInputField';
import { FILE_DROPS_LEFT } from './CodeSurface';

// The code box as the example field draws it, saying what it was asked.
vi.mock('./CodeField', async () => {
  const react = await import('react');
  return {
    default: ({ keepFileDropsOut }: { keepFileDropsOut?: boolean }) => react.createElement('div', { 'data-file-drops-out': String(!!keepFileDropsOut) }),
  };
});

/**
 * A file dropped on step 1's example box is taken as a run hands it on
 * (`droppedFile`) -- and CodeMirror's own drop handler read the same file and
 * typed its text into the box as well.
 */
describe('a file dropped on the example box', () => {
  it('is kept out of the code box it is dropped on, which leaves it to the field', () => {
    const html = renderToStaticMarkup(createElement(ExampleInputField, {
      text: '', onText: (text: string) => text, ports: [{ id: 'input' }], reads: [],
    }));
    expect(html).toContain('data-file-drops-out="true"');
  });

  it('is told to CodeMirror as handled, so it types nothing in -- and text dragged in is still its own', () => {
    const drop = (files: number, text = '') => ({ dataTransfer: { files: { length: files }, getData: () => text } }) as unknown as DragEvent;
    expect(FILE_DROPS_LEFT.drop(drop(1))).toBe(true);
    expect(FILE_DROPS_LEFT.drop(drop(0, 'some words'))).toBe(false);
  });
});
