import { describe, expect, it } from 'vitest';
import type { Port } from '@/graph';
import { caughtErrorAt, portIdProblems } from './portIds';

const port = (id: string, kind: 'input' | 'output' = 'input'): Port =>
  ({ id, name: id, kind, data_type: 'any', multi: false, required: false, description: '' });
const outputs = (...ids: string[]) => ids.map((id) => port(id, 'output'));

describe('the names a node panel saves its ports under', () => {
  it('will not save two ports of one name, which merged their wires into one value', () => {
    expect(portIdProblems([port('a'), port('a')], [], false).inputs).toBe('Two inputs are both called "a".');
    expect(portIdProblems([], outputs('out', 'out'), false).outputs).toBe('Two outputs are both called "out".');
  });

  it('will not save a port with no name, which no body can read', () => {
    expect(portIdProblems([port('')], [], false).inputs).toBe('An input has no name.');
  });

  it('keeps the error port\'s name to "catch failures", and lets the one it added be', () => {
    expect(portIdProblems([], outputs('output', 'error'), true)).toEqual({ inputs: '', outputs: '' });
    expect(portIdProblems([], outputs('error'), false).outputs).toContain('cannot be called "error"');
    expect(portIdProblems([], outputs('error', 'error'), true).outputs).toContain('cannot be called "error"');
  });

  it('finds the port "catch failures" added where it stands, so an output typed "error" stays where it is edited', () => {
    // Split off by name, the row jumped into the fixed list mid-word.
    expect(caughtErrorAt(outputs('error', 'output'), false)).toBe(-1);
    expect(caughtErrorAt(outputs('error', 'error'), true)).toBe(1);
    expect(caughtErrorAt(outputs('output'), true)).toBe(-1);
  });

  it('says nothing about ports that can be saved', () => {
    expect(portIdProblems([port('a'), port('b')], outputs('out'), false)).toEqual({ inputs: '', outputs: '' });
  });
});
