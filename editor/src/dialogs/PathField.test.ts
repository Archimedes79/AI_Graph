import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PathField, { FileTypesField, nameToSave } from './PathField';

describe('a path field', () => {
  it('browses for a file to save with its current name filled in, so choosing a folder keeps it', () => {
    expect(nameToSave('out/report.txt')).toBe('report.txt');
    expect(nameToSave('C:\\data\\sum.json')).toBe('sum.json');
    expect(nameToSave('')).toBeUndefined();
  });

  it('is a box and 📂 Browse… on one line, with what the place adds after it', () => {
    const html = renderToStaticMarkup(createElement(PathField, {
      value: 'data', onChange: () => {}, mode: 'directory', ariaLabel: 'Folder', children: createElement('button', null, '✕'),
    }));
    expect(html).toMatch(/<input[^>]*aria-label="Folder"[^>]*value="data"/);
    expect(html).toMatch(/📂 Browse…<\/button><button>✕<\/button>/);
  });

  it('asks for the file types in the same words wherever it is asked', () => {
    const html = renderToStaticMarkup(createElement(FileTypesField, { value: '.md', onChange: () => {}, onSurface: true }));
    expect(html).toContain('File types (comma-separated, e.g. .md, .txt)');
    expect(html).toMatch(/<input[^>]*aria-label="File types"[^>]*value=".md"/);
  });
});
