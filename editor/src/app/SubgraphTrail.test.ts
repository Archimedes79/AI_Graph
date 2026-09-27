import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SubgraphTrail from './SubgraphTrail';

// Rendered to a string, a component reads the store's first state, not the
// one a test has since moved it to -- so what the trail asks is answered here.
// There is no `closeSubgraph` to ask: a crumb that closed level after level
// until its depth was reached spun forever during a run, when none closes.
// (Vitest lifts both of these above the imports.)
const level = vi.hoisted(() => ({
  subgraphStack: [] as unknown[],
  isExecuting: false,
  closeSubgraphsTo: (_depth: number) => {},
}));
vi.mock('@/store/graphStore', () => ({
  useGraphStore: (select: (state: typeof level) => unknown) => select(level),
}));

const inner = (name: string, nodeId: string, label: string) => ({
  nodeId, graph: { metadata: { name }, nodes: [{ id: nodeId, label }] }, past: [], future: [],
});

/** The crumbs' buttons, as the component made them. */
function crumbs(): ReactElement<{ disabled: boolean; title: string; onClick: () => void }>[] {
  const found: ReactElement<{ disabled: boolean; title: string; onClick: () => void }>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const element = node as ReactElement<{ children?: unknown }>;
    if (element.type === 'button') found.push(element as never);
    walk(element.props.children);
  };
  walk(SubgraphTrail());
  return found;
}

describe('the way back out of a node\'s graph', () => {
  it('is not there at the top', () => {
    level.subgraphStack = [];
    expect(renderToStaticMarkup(createElement(SubgraphTrail))).toBe('');
  });

  it('names every level, and each crumb goes back out to its own', () => {
    level.subgraphStack = [inner('Tool', 'part', 'Part'), inner('Part', 'step', 'Step')];
    const asked: number[] = [];
    level.closeSubgraphsTo = (depth) => { asked.push(depth); };
    const [top, part, here] = crumbs();

    expect(renderToStaticMarkup(createElement(SubgraphTrail))).toMatch(/Tool.*Part.*Step/);
    expect(here.props.disabled).toBe(true);
    top.props.onClick();
    part.props.onClick();
    expect(asked).toEqual([0, 1]);
  });

  it('waits for a run, and says so instead of a crumb that does nothing', () => {
    level.subgraphStack = [inner('Tool', 'part', 'Part')];
    level.isExecuting = true;
    try {
      const [top] = crumbs();
      expect(top.props.disabled).toBe(true);
      expect(top.props.title).toMatch(/A run is going on/);
    } finally {
      level.isExecuting = false;
    }
  });
});
