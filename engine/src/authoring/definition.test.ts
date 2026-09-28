import { describe, it, expect } from 'vitest';
import { definitionExample, definitionKeys, definitionShape, misfits, textOutput } from './definition.ts';

const INPUT = `/**
 * @typedef {Object} Input
 * @property {string} csv  a CSV's text: a header row, then one row per country
 */
module.exports = { "csv": "Country,Population\\nIndia,1450" };
`;

describe('a definition\'s example', () => {
  it('is the JSON after module.exports, up to the final semicolon', () => {
    expect(definitionExample(INPUT)).toEqual({ example: { csv: 'Country,Population\nIndia,1450' } });
    // A semicolon inside the example is the example's; one after it ends it.
    expect(definitionExample('module.exports = { "a": "x;y" };')).toEqual({ example: { a: 'x;y' } });
    expect(definitionExample('module.exports = { "a": 1 }')).toEqual({ example: { a: 1 } });
    expect(definitionExample('module.exports={"a":1}; // the end')).toEqual({ example: { a: 1 } });
  });

  it('is read as require() reads the file: a comment or a string is not the end of it, nor the start', () => {
    // A semicolon-separated CSV, and no final semicolon.
    expect(definitionExample('module.exports = { "csv": "a;b\\n1;2" }')).toEqual({ example: { csv: 'a;b\n1;2' } });
    // A comment after it, with semicolons of its own.
    expect(definitionExample('module.exports = { "a": 1 }; // a; b')).toEqual({ example: { a: 1 } });
    // A JSDoc that mentions module.exports = before the one that is code.
    expect(definitionExample('/**\n * One example, as module.exports = { … } says it.\n */\nmodule.exports = { "a": 2 };')).toEqual({ example: { a: 2 } });
    // A string holding it is no assignment either.
    expect(definitionExample('const note = "module.exports = 1";\nmodule.exports = { "b": [1, { "c": "}" }] };')).toEqual({ example: { b: [1, { c: '}' }] } });
  });

  it('says in a sentence what is wrong with one that is not plain JSON', () => {
    const quoted = definitionExample("module.exports = { csv: 'a,b' };");
    expect('problem' in quoted && quoted.problem).toMatch(/not plain JSON .*double-quoted keys/);
    const missing = definitionExample('/** @typedef {Object} Input */');
    expect('problem' in missing && missing.problem).toMatch(/no "module.exports/);
    const list = definitionExample('module.exports = [1, 2];');
    expect('problem' in list && list.problem).toMatch(/not an object keyed by port/);
  });

  it('names the ports: its keys, or none when it cannot be read', () => {
    expect(definitionKeys(INPUT)).toEqual(['csv']);
    expect(definitionKeys('module.exports = { "summary": "", "count": 2 };')).toEqual(['summary', 'count']);
    expect(definitionKeys('')).toEqual([]);
    expect(definitionKeys('module.exports = { oops };')).toEqual([]);
  });

  it('names the one output an answer in plain text is, where it names one that holds text', () => {
    expect(textOutput('/** @typedef {Object} Output */\nmodule.exports = { "summary": "Two sentences." };')).toBe('summary');
    // Several outputs, or one that is not text: the answer is JSON.
    expect(textOutput('module.exports = { "summary": "", "count": 2 };')).toBeUndefined();
    expect(textOutput('module.exports = { "count": 2 };')).toBeUndefined();
    expect(textOutput('module.exports = { "rows": ["a"] };')).toBeUndefined();
    expect(textOutput('module.exports = { oops };')).toBeUndefined();
  });
});

describe('what one call returned, held to an output definition', () => {
  const OUTPUT = 'module.exports = { "figure": { "kind": "bars", "points": [{ "label": "India", "value": 1450 }] } };';

  it('fits when it has the keys, in the shape of the example', () => {
    expect(definitionShape(OUTPUT)?.properties?.figure?.type).toBe('object');
    expect(misfits({ figure: { kind: 'line', points: [] } }, OUTPUT)).toEqual([]);
  });

  it('says where it does not: the output, named once, and the place in it', () => {
    expect(misfits({}, OUTPUT)).toEqual(['output "figure" is missing']);
    expect(misfits({ figure: { kind: 'bars', points: [{ label: 'India', value: 'many' }] } }, OUTPUT))
      .toEqual(['output "figure" at points[0].value is text; output.js says a number']);
    expect(misfits({ figure: 3 }, OUTPUT)).toEqual(['output "figure" is a number; output.js says an object']);
  });

  it('holds nothing to a definition that cannot be read: check says that, once', () => {
    expect(misfits({}, 'module.exports = { figure };')).toEqual([]);
    expect(misfits({}, '')).toEqual([]);
  });
});
