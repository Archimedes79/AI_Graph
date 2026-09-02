import { describe, it, expect } from 'vitest';
import { SelectElement } from './element.ts';
import type { Widget } from '../../../../element.ts';

function widget(config: Record<string, unknown>): Widget {
  return { id: 'w', kind: 'select', label: 'Size', w: 6, h: 2, tone: 'sunken', config };
}

describe('a dropdown', () => {
  it('parses one option per line, dropping blanks', () => {
    const element = new SelectElement();
    expect(element.config(widget({ options: 'A\n\nB\nC ' })).options).toEqual(['A', 'B', 'C']);
  });

  it('defaults to the first option', () => {
    const element = new SelectElement();
    expect(element.config(widget({ options: 'A\nB' })).value).toBe('A');
  });

  it('keeps a stored choice that is still in the list', () => {
    const element = new SelectElement();
    expect(element.config(widget({ options: 'A\nB', value: 'B' })).value).toBe('B');
  });

  it('falls back to the first option when the stored one was retired', () => {
    const element = new SelectElement();
    expect(element.config(widget({ options: 'A\nB', value: 'C' })).value).toBe('A');
  });

  it('emits the chosen value on its one output port, and takes no input', async () => {
    const element = new SelectElement();
    const w = widget({ options: 'A\nB', value: 'B' });
    expect(element.ports(w)).toEqual({ inputs: [], outputs: [expect.objectContaining({ id: 'w_out', data_type: 'text' })] });
    expect(await element.execute(w)).toEqual({ w_out: 'B' });
  });
});
