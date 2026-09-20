import { describe, it, expect } from 'vitest';
import { ButtonWidgetRunner } from './ButtonWidgetRunner.ts';
import type { Widget } from '../../WidgetRunner.ts';

function widget(config: Record<string, unknown>): Widget {
  return { id: 'w', kind: 'button', label: 'Confirm', w: 5, h: 2, tone: 'plain', config };
}

describe('a button', () => {
  it('starts at zero presses', () => {
    const element = new ButtonWidgetRunner();
    expect(element.config(widget({})).count).toBe(0);
  });

  it('keeps the press count the page changes, floored and never negative', () => {
    const element = new ButtonWidgetRunner();
    expect(element.config(widget({ value: 3.7 })).count).toBe(3);
    expect(element.config(widget({ value: -1 })).count).toBe(0);
    expect(element.config(widget({ value: 'not a number' })).count).toBe(0);
  });

  it('has one output port and no input, saying whether it was pressed just now', async () => {
    const element = new ButtonWidgetRunner();
    const w = widget({ value: 2 });
    const runtime = (fired: boolean) => ({ fired: (port: string) => port === 'w_out' && fired }) as never;
    expect(element.ports(w)).toEqual({ inputs: [], outputs: [expect.objectContaining({ id: 'w_out', data_type: 'boolean' })] });
    expect(await element.execute(w, {}, runtime(true))).toEqual({ w_out: true });
    expect(await element.execute(w, {}, runtime(false))).toEqual({ w_out: false });
    // Outside a run nobody's event started anything, which counts every event as having happened.
    expect(await element.execute(w, {}, {} as never)).toEqual({ w_out: true });
  });
});
