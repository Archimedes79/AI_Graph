import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExampleInputField, { withPortValue } from './ExampleInputField';
import { relativeTo } from './readAsRun';

describe('step 1\'s example input', () => {
  it('is edited whole, however long: an edit never stores a shortened copy as the value', () => {
    // Try it showed a long value clipped, "… N more characters …" and all, in
    // the box that was edited -- and one changed character stored the clip.
    const long = JSON.stringify({ rows: Array.from({ length: 200 }, (_, index) => ({ index, name: `row ${index}` })) }, null, 2);
    const html = renderToStaticMarkup(createElement(ExampleInputField, {
      text: long, onText: (text: string) => text, ports: [{ id: 'rows' }], pathPorts: [],
    }));
    expect(html).toContain('row 199');
    expect(html).not.toContain('more characters');
  });

  it('takes a picked file in on its own port, beside what is there', () => {
    expect(JSON.parse(withPortValue('{"top": 5}', 'csv', 'data/people.csv'))).toEqual({ top: 5, csv: 'data/people.csv' });
    // What does not parse yet is not kept around a picked file.
    expect(JSON.parse(withPortValue('{"top": ', 'csv', 'a'))).toEqual({ csv: 'a' });
  });
});

describe('a picked path, as the graph keeps it', () => {
  it('is relative to the folder a run resolves it against, so the graph opens the same elsewhere', () => {
    // The 📎 kept an absolute path to an uploaded copy under the server's
    // folder: moved, or opened from another folder, the sample was gone.
    expect(relativeTo('D:\\work\\graphs', 'D:\\work\\graphs\\data\\people.csv')).toBe('data/people.csv');
    expect(relativeTo('d:/work/graphs/', 'D:/Work/Graphs/data/people.csv')).toBe('data/people.csv');
    expect(relativeTo('/home/me/graphs', '/home/me/graphs/data/a.csv')).toBe('data/a.csv');
    // Anywhere else, and in a folder that only starts the same, it stays as it is.
    expect(relativeTo('/home/me/graphs', '/tmp/a.csv')).toBe('/tmp/a.csv');
    expect(relativeTo('/home/me/graphs', '/home/me/graphs2/a.csv')).toBe('/home/me/graphs2/a.csv');
  });
});
