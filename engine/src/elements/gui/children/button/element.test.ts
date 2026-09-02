import { describe, it, expect } from 'vitest';
import { ButtonElement } from './element.ts';
import type { Widget } from '../../../../element.ts';

function widget(config: Record<string, unknown>): Widget {
  return { id: 'w', kind: 'button', label: 'Confirm', w: 5, h: 2, tone: 'plain', config };
}

describe('a button', () => {
  it('starts at zero presses', () => {
    const element = new ButtonElement();
    expect(element.config(widget({})).count).toBe(0);
  });

  it('emits the stored press count, floored and never negative', () => {
    const element = new ButtonElement();
    expect(element.config(widget({ value: 3.7 })).count).toBe(3);
    expect(element.config(widget({ value: -1 })).count).toBe(0);
    expect(element.config(widget({ value: 'not a number' })).count).toBe(0);
  });

  it('has one output port and no input, emitting the count', async () => {
    const element = new ButtonElement();
    const w = widget({ value: 2 });
    expect(element.ports(w)).toEqual({ inputs: [], outputs: [expect.objectContaining({ id: 'w_out', data_type: 'number' })] });
    expect(await element.execute(w, {})).toEqual({ w_out: 2 });
  });
});
