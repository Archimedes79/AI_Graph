import { describe, it, expect } from 'vitest';
import type { BodyContext, Runtime } from './Runtime.ts';
import type { GraphNode } from '../graph.ts';
import { runBody } from './body.ts';
import { registry } from './registry.ts';
import { selectFiles } from './fileSelection.ts';
import { Logic } from '../authoring/logic.ts';

/**
 * One way to run a body: whichever element it belongs to, it is handed the
 * same second argument and may ask the same question.
 */

function watching(): { runtime: Runtime; seen: { body: string; context?: BodyContext }[] } {
  const seen: { body: string; context?: BodyContext }[] = [];
  const runtime: Runtime = {
    files: { read: async () => '', write: async () => {}, list: async () => ['a.txt', 'b.txt'], resolve: (p) => p, exists: async () => true },
    code: {
      run: async (body, inputs, _signal, context) => {
        seen.push({ body, context });
        return body.includes('files') ? { files: ['b.txt'] } : { value: inputs.value, output: 'ran' };
      },
    },
    ai: { complete: async () => 'an answer' },
  };
  return { runtime, seen };
}

const node = (type: string, config: Record<string, unknown>): GraphNode => ({
  id: 'n', node_type: type as GraphNode['node_type'], label: 'N', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
});

describe('runBody', () => {
  it('hands every body a node it can ask a model through', async () => {
    const { runtime, seen } = watching();
    await runBody('function run() {}', {}, runtime);
    expect(Object.keys(seen[0].context?.calls ?? {})).toEqual(['llm']);
    expect(await seen[0].context!.calls!.llm({ prompt: 'anything' })).toBe('an answer');
  });

  it('hands on the plain data an element gives its body', async () => {
    const { runtime, seen } = watching();
    await runBody('function run() {}', {}, runtime, { data: { texts: { system: 'Be brief.' } } });
    expect(seen[0].context?.data).toEqual({ texts: { system: 'Be brief.' } });
  });
});

describe('every kind of body runs that way', () => {
  it('a code node\'s', async () => {
    const { runtime, seen } = watching();
    await registry.node('code')!.execute(node('code', { code: 'function run() { return { output: 1 }; }' }), {}, runtime);
    expect(seen[0].context?.calls).toHaveProperty('llm');
  });

  it('a changed run.js', async () => {
    const { runtime, seen } = watching();
    await registry.node('ai')!.execute(node('ai', { run_code: 'async function run() { return { output: "mine" }; }', system_prompt: 'S' }), {}, runtime);
    expect(seen[0].context?.calls).toHaveProperty('llm');
    expect(seen[0].context?.data).toMatchObject({ texts: { system: 'S' } });
  });

  it('the code that chooses files', async () => {
    const { runtime, seen } = watching();
    const logic = new Logic('code', '', 'function run({ files }) { return { files }; }', { body: 'selector_code', prompt: 'selector_prompt' });
    const chosen = await selectFiles(logic, { recursive: false, extensions: '', selectAll: false }, 'folder', runtime);
    expect(chosen).toEqual(['b.txt']);
    expect(seen[0].context?.calls).toHaveProperty('llm');
  });

  it('the code a display block shapes its value with', async () => {
    const { runtime, seen } = watching();
    const table = registry.widget('table')!;
    await table.runSnippet({ id: 't', kind: 'table', label: '', w: 4, h: 4, tone: 'plain', config: { code: 'function run({ value }) { return { value }; }' } } as never, { value: 1 }, runtime);
    expect(seen[0].context?.calls).toHaveProperty('llm');
  });
});

describe('a bundle knows a body asks a model', () => {
  it('in a code node, and not in one that never mentions it', () => {
    const element = registry.node('code')!;
    expect(element.deployNeeds(node('code', { code: 'async function run(i, node) { return { a: await node.llm({ prompt: "x" }) }; }' })).asksAi).toBe(true);
    expect(element.deployNeeds(node('code', { code: 'function run() { return { a: 1 }; }' })).asksAi).toBe(false);
  });

  it('in a block on a page', () => {
    const page = (code: string) => node('gui', { gui_widgets: [{ id: 't', kind: 'table', code }] });
    const element = registry.node('gui')!;
    expect(element.deployNeeds(page('async function run({ value }, { llm }) { return { value: await llm({ prompt: value }) }; }'))).toEqual({ needsInterface: true, asksAi: true });
    expect(element.deployNeeds(page('function run({ value }) { return { value }; }'))).toEqual({ needsInterface: true, asksAi: false });
  });
});
