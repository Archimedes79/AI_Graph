/**
 * A saved node carries its own settings, not every field every node starts with
 * -- and the engine cannot tell the difference.
 *
 * `NodeUi.saved` drops a key its node does not own when it still holds the
 * value every node is created with. That is only safe while the engine reads a
 * missing key the same way it reads that value, so this asks the engine's own
 * element, for every node type and every mode, the questions a run asks, and
 * holds the lean node to the full node's answers.
 */
import { describe, it, expect } from 'vitest';
import { registry } from '@engine/elements/registry.ts';
import type { GraphNode as EngineNode } from '@engine/graph.ts';
import type { GraphNode, NodeConfig } from '@/graph';
import { NODE_UIS } from './registry';

/** What a run asks a node's element before and while running it. None of them runs anything. */
const QUESTIONS = [
  'config', 'batchMode', 'batchConcurrency', 'readsFileInputs', 'catchesErrors', 'needsInput',
  'derivedPorts', 'runtimeRequirements', 'referencedPaths', 'logic',
] as const;

function answers(node: GraphNode): Record<string, string> {
  const element = registry.node(node.node_type) as unknown as Record<string, (node: EngineNode) => unknown>;
  return Object.fromEntries(QUESTIONS
    .filter((question) => typeof element[question] === 'function')
    .map((question) => [question, JSON.stringify(element[question](node as EngineNode)) ?? 'undefined']));
}

/** Each node type as created, and once more in every mode that changes what it reads. */
function variants(): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const ui of Object.values(NODE_UIS)) nodes.push(ui.create('n'));
  const input = (mode: NodeConfig['input_mode']) =>
    ({ ...NODE_UIS.input.create('n'), config: { ...NODE_UIS.input.create('n').config, input_mode: mode } });
  const output = (mode: NodeConfig['write_mode']) =>
    ({ ...NODE_UIS.output.create('n'), config: { ...NODE_UIS.output.create('n').config, write_mode: mode } });
  nodes.push(input('file'), input('directory'), output('none'), output('file'), output('directory'));
  return nodes;
}

describe('NodeUi.saved', () => {
  it.each(variants().map((node) => [`${node.node_type} (${node.config.input_mode}/${node.config.write_mode})`, node]))(
    '%s: the engine sees the lean node exactly as the full one',
    (_name, node) => {
      const lean = NODE_UIS[node.node_type].saved(node);
      expect(answers(lean)).toEqual(answers(node));
    },
  );

  it('leaves out what the node does not own, and keeps what it owns', () => {
    const node = NODE_UIS.output.create('n');
    const lean = NODE_UIS.output.saved(node);
    expect(Object.keys(lean.config).length).toBeLessThan(Object.keys(node.config).length / 3);
    expect(lean.config).toMatchObject({ output_label: 'Result', write_mode: 'window' });
    expect(lean.config).not.toHaveProperty('system_prompt');
  });

  it('keeps a key it does not own once somebody changed it', () => {
    const node = NODE_UIS.output.create('n');
    node.config.temperature = 0.1;
    expect(NODE_UIS.output.saved(node).config.temperature).toBe(0.1);
  });
});
