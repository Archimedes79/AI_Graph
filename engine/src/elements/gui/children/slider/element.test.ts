import { describe, it, expect } from 'vitest';
import { SliderElement } from './element.ts';
import type { Widget } from '../../../../element.ts';

function widget(config: Record<string, unknown>): Widget {
  return { id: 'w', kind: 'slider', label: 'Amount', w: 8, h: 2, tone: 'sunken', config };
}

describe('a slider', () => {
  it('defaults to 0..100 in steps of 1', () => {
    const element = new SliderElement();
    expect(element.config(widget({}))).toEqual({ value: 0, min: 0, max: 100, step: 1 });
  });

  it('clamps a stored value to the current range', () => {
    const element = new SliderElement();
    expect(element.config(widget({ value: 500, min: 0, max: 10 })).value).toBe(10);
    expect(element.config(widget({ value: -5, min: 0, max: 10 })).value).toBe(0);
  });

  it('refuses a max at or below min, widening it by one instead', () => {
    const element = new SliderElement();
    expect(element.config(widget({ min: 5, max: 5 })).max).toBe(6);
  });

  it('emits its current value as a number, on its one output port', async () => {
    const element = new SliderElement();
    const w = widget({ value: 42, min: 0, max: 100 });
    expect(element.ports(w).outputs[0]).toMatchObject({ id: 'w_out', data_type: 'number' });
    expect(await element.execute(w)).toEqual({ w_out: 42 });
  });
});
