import { describe, it, expect } from 'vitest';
import { InputPickerWidgetRunner } from './InputPickerWidgetRunner.ts';
import { parseWidget } from '../../nodes/gui/GuiNodeRunner.ts';
import { nodeFiles } from '../../../host/node.ts';
import type { Runtime } from '../../Runtime.ts';
import type { RawConfig } from '../../../graph.ts';

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
    const element = new InputPickerWidgetRunner();
    expect(element.config(widget)).toMatchObject({ path: '/data/x.csv', directory: false });
  });

  it('names its port after its label, falling back to the id', () => {
    const element = new InputPickerWidgetRunner();
    const labelled = parseWidget({ id: 'w1', kind: 'input_picker', label: 'Source file' });
    expect(element.ports(labelled).outputs[0].name).toBe('Source file');

    const unlabelled = parseWidget({ id: 'w1', kind: 'input_picker' });
    expect(element.ports(unlabelled).outputs[0].name).toBe('w1');
  });

  it('emits a resolved path when run', async () => {
    const widget = parseWidget({ id: 'w1', kind: 'input_picker', value: '/data/x.csv' });
    const element = new InputPickerWidgetRunner();
    const result = await element.execute(widget, {}, runtime);
    expect(String(result.w1_out)).toContain('x.csv');
  });

  it('is a question while nothing is chosen, and keeps the answer as what it holds', () => {
    const element = new InputPickerWidgetRunner();
    const unchosen = parseWidget({ id: 'w1', kind: 'input_picker', label: 'Folder', mode: 'directory' });
    expect(element.runtimeRequirements(unchosen)).toEqual([{ label: 'Folder', kind: 'directory', direction: 'input', current: '' }]);
    expect(element.runtimeRequirements(parseWidget({ id: 'w1', kind: 'input_picker', value: 'a.csv' }))).toEqual([]);
    const stored: RawConfig = { id: 'w1', kind: 'input_picker' };
    element.applyRuntimeValue(stored, '/data');
    expect(stored.value).toBe('/data');
  });

  it('names the file it starts on, for a bundle to carry', () => {
    const element = new InputPickerWidgetRunner();
    expect(element.referencedPaths(parseWidget({ id: 'w1', kind: 'input_picker', value: 'data.csv' }))).toEqual(['data.csv']);
    expect(element.referencedPaths(parseWidget({ id: 'w1', kind: 'input_picker' }))).toEqual([]);
  });
});
