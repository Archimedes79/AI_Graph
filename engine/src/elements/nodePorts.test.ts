import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseGraph } from '../graph.ts';
import { registry } from '../registry.ts';

/**
 * Derived ports, checked against graphs people actually built.
 *
 * Only some nodes derive their ports: an input node from its mode, a gui node
 * from its blocks. For those a declaration nobody checks is a second copy
 * waiting to drift — which is how an input node came to emit `output` while its
 * stored ports said `files` and `count`.
 *
 * The others are skipped, and writing this test is what showed why. A code
 * node's input is called `file` and an output node's `einzeln`, because the
 * person who wired them named them to match their code and their prompt. An
 * element declaring `input` and `value` for those would be inventing a contract
 * nobody agreed to — so it declares nothing, and the graph is the authority.
 *
 * Both directions matter for the derived ones: a missing declaration breaks the
 * editor, an extra one draws a handle nothing will ever fill.
 */

const EXAMPLES = resolve(__dirname, '..', '..', '..', 'examples');

describe('derived node ports match the graphs people built', () => {
  it('agrees with every example, in both directions', async () => {
    const files = (await readdir(EXAMPLES)).filter((name) => name.endsWith('.json'));
    expect(files.length).toBeGreaterThan(2);

    const differences: string[] = [];
    let checked = 0;

    for (const name of files) {
      const graph = parseGraph(JSON.parse(await readFile(join(EXAMPLES, name), 'utf8')));
      for (const node of graph.nodes) {
        const declared = registry.node(node.node_type)?.derivedPorts(node);
        if (!declared) continue;
        checked += 1;

        for (const side of ['inputs', 'outputs'] as const) {
          const stored = new Set(node[side].map((p) => p.id));
          const says = new Set(declared[side].map((p) => p.id));
          for (const id of stored) {
            if (!says.has(id)) differences.push(`${name} ${node.id}.${side}: has ${id}, the element does not declare it`);
          }
          for (const id of says) {
            if (!stored.has(id)) differences.push(`${name} ${node.id}.${side}: the element declares ${id}, the graph has no such port`);
          }
        }
      }
    }

    expect(differences).toEqual([]);
    // Otherwise this passes by checking nothing.
    expect(checked).toBeGreaterThan(2);
  });
});
