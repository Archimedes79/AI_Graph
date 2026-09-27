import { describe, it, expect } from 'vitest';
import { definitionExample, definitionKeys, definitionShape, misfits } from './definition.ts';

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
});

describe('what one call returned, held to an output definition', () => {
  const OUTPUT = 'module.exports = { "figure": { "kind": "bars", "points": [{ "label": "India", "value": 1450 }] } };';

  it('fits when it has the keys, in the shape of the example', () => {
    expect(definitionShape(OUTPUT)?.properties?.figure?.type).toBe('object');
    expect(misfits({ figure: { kind: 'line', points: [] } }, OUTPUT)).toEqual([]);
  });

  it('says where it does not', () => {
    expect(misfits({}, OUTPUT)).toEqual(['output.figure is missing']);
    expect(misfits({ figure: { kind: 'bars', points: [{ label: 'India', value: 'many' }] } }, OUTPUT).join(' '))
      .toMatch(/output\.figure\.points\[0\]\.value is string/);
  });

  it('holds nothing to a definition that cannot be read: check says that, once', () => {
    expect(misfits({}, 'module.exports = { figure };')).toEqual([]);
    expect(misfits({}, '')).toEqual([]);
  });
});
