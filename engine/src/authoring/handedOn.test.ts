import { describe, it, expect } from 'vitest';
import { parseGraph } from '../graph.ts';
import { AUTHORING_KEYS, withoutAuthoring } from './handedOn.ts';

/** What a graph carries when it is handed on: what runs, and not how each node was written. */

const written = {
  code: 'function run(inputs) { return { output: inputs.input }; }',
  history: '## 2026-09-28 09:30 · ✨ Input\n\nPrompt:\n```\nIBAN DE00 1234 …\n```',
  prompts: { input: 'Mine.' },
  input_files: ['data/accounts.csv'],
  output_files: ['spec.md'],
};

const graph = () => parseGraph({
  metadata: { name: 'Handed on' },
  nodes: [
    { id: 'count', node_type: 'code', label: 'Count', config: { ...written } },
    {
      id: 'part', node_type: 'subgraph', label: 'Part',
      config: { subgraph: { metadata: { name: 'Part' }, nodes: [{ id: 'inner', node_type: 'code', label: 'Inner', config: { ...written } }], edges: [] } },
    },
  ],
  edges: [],
});

describe('a graph handed on', () => {
  it('carries no history, no ✨ prompts and no files ✨ was given -- in the graphs its nodes hold too -- and what runs, whole', () => {
    const original = graph();
    const handed = withoutAuthoring(original);
    const inner = (handed.nodes[1].config.subgraph as { nodes: { config: Record<string, unknown> }[] }).nodes[0].config;
    for (const config of [handed.nodes[0].config as Record<string, unknown>, inner]) {
      for (const key of AUTHORING_KEYS) expect(config, key).not.toHaveProperty(key);
      expect(config.code).toBe(written.code);
    }
    // A copy: the project keeps its record.
    expect(original.nodes[0].config.history).toBe(written.history);
  });
});
