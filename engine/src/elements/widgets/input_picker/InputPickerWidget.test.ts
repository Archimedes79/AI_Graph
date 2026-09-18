import { describe, it, expect } from 'vitest';
import { InputPickerWidget } from './InputPickerWidget.ts';
import { parseWidget } from '../../nodes/gui/GuiNode.ts';
import { nodeFiles } from '../../../host/node.ts';
import type { Runtime } from '../../Runtime.ts';

/**
 * Exercised through `parseWidget`, the one place a real `Widget` is built,
 * rather than a hand-built object -- so this is what a stored block actually
 * produces, not a shape the test assumes.
 */

const runtime: Runtime = {
  files: nodeFiles,
  code: { run: async (_body, inputs) => inputs },
  ai: { complete: async () => '' },
};

describe('a file picker', () => {
  it('reads its settings out of the stored record', () => {
    const widget = parseWidget({ id: 'w1', kind: 'input_picker', label: 'Pick', value: '/data/x.csv' });
    const element = new InputPickerWidget();
    expect(element.config(widget)).toMatchObject({ path: '/data/x.csv', directory: false });
  });

  it('names its port after its label, falling back to the id', () => {
    const element = new InputPickerWidget();
    const labelled = parseWidget({ id: 'w1', kind: 'input_picker', label: 'Source file' });
    expect(element.ports(labelled).outputs[0].name).toBe('Source file');

    const unlabelled = parseWidget({ id: 'w1', kind: 'input_picker' });
    expect(element.ports(unlabelled).outputs[0].name).toBe('w1');
  });

  it('emits a resolved path when run', async () => {
    const widget = parseWidget({ id: 'w1', kind: 'input_picker', value: '/data/x.csv' });
    const element = new InputPickerWidget();
    const result = await element.execute(widget, {}, runtime);
    expect(String(result.w1_out)).toContain('x.csv');
  });
});
