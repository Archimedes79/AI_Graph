import { describe, expect, it } from 'vitest';

/**
 * The editor's layers, asserted on the import graph.
 *
 * An area may import from a lower one, never from a higher one, and never from
 * a sibling of its own rank. What each rank is:
 *
 *   0 ui         look, without knowing a graph: theme, tone, colour scheme, Modal
 *   1 graph      the document's types
 *   2 document   what a graph *is* to the editor: node kinds, a page's ports, grid placement
 *     api        the contract's client
 *   3 store      the open graph, its runs, its undo
 *   4 dialogs    small dialogs that ask the server something
 *   5 elements   the builders, their panels and their views
 *     authoring  writing a body: the editors a panel is made of
 *   6 page       a page, drawn and designed
 *     canvas     the graph, drawn
 *   7 app        toolbar, sidebar, results
 *   8 App, runtime   the two things that are served
 *   9 main       the entry
 *
 * `elements` and `authoring` are one tier and reach each other on purpose: a panel
 * is made of authoring editors, and an authoring editor asks the registry what a
 * node is. A panel is a lazy chunk, so the static graph has no cycle in it
 * (`runtime/boundary.test.ts` holds that a tool never loads either).
 */
const RANK: Record<string, number> = {
  ui: 0, graph: 1, document: 2, api: 2, store: 3, dialogs: 4, elements: 5, authoring: 5,
  page: 6, canvas: 6, app: 7, App: 8, runtime: 8, main: 9,
};
const SIBLINGS = new Set(['elements>authoring', 'authoring>elements']);

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FILES = new Map(
  Object.entries(SOURCES)
    .filter(([path]) => !/\.(test|d)\.tsx?$/.test(path))
    .map(([path, source]) => [path.replace(/^\/src\//, ''), source]),
);

const areaOf = (path: string): string => (path.includes('/') ? path.split('/')[0] : path.replace(/\.tsx?$/, ''));

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const parts = spec.startsWith('@/') ? spec.slice(2).split('/') : from.split('/').slice(0, -1).concat(spec.split('/'));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  return [base, `${base}.ts`, `${base}.tsx`].find((candidate) => FILES.has(candidate)) ?? null;
}

describe('the editor layers', () => {
  it('are found, so the rule below is checked against something', () => {
    expect(FILES.size).toBeGreaterThan(100);
    for (const area of new Set([...FILES.keys()].map(areaOf))) {
      expect(RANK[area], `${area}/ has no rank: say where it stands in the list above`).toBeDefined();
    }
  });

  it('are only imported from above', () => {
    const against: string[] = [];
    for (const [path, source] of FILES) {
      for (const match of source.matchAll(/(?:from|import\()\s*'((?:\.|@\/)[^']+)'/g)) {
        const target = resolve(path, match[1]);
        if (!target) continue;
        const [from, to] = [areaOf(path), areaOf(target)];
        if (from === to) continue;
        const allowed = RANK[to] < RANK[from] || (RANK[to] === RANK[from] && SIBLINGS.has(`${from}>${to}`));
        if (!allowed) against.push(`${path} -> ${target}   (${from} ${RANK[from]}, ${to} ${RANK[to]})`);
      }
    }
    expect(against).toEqual([]);
  });
});
