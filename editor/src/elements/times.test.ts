import { describe, it, expect } from 'vitest';

/**
 * Build time and run time in a `Ui`, the mirror of the engine's
 * `elements/times.test.ts`.
 *
 * A `Ui` is one class per kind: what a deployed tool draws with (`View`, a few
 * flags) and what only the editor asks (the palette, `create`, panels, what
 * ✨ Generate is told). The second kind travels into a tool with the class; it
 * must never be *used* there. So the base classes say which is which under
 * three bars, and everything a tool can reach is held to the run-time names.
 */

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const BY_PATH = new Map(Object.entries(SOURCES).map(([key, source]) => [key.replace(/^\/src\//, ''), source]));

const BARS = ['What it is', 'Run time', 'Build time'];
const BAR = /^ {2}\/\/ ── (What it is|Run time|Build time) ─+$/;
const MEMBER = /^ {2}(?:(?:abstract|readonly|protected|override|async) )*([A-Za-z]+)[?(:<= ]/;

/** Each member of the class in *path*, with the bar it stands under. */
function membersOf(path: string): Map<string, number> {
  const found = new Map<string, number>();
  let block = -1;
  let inside = false;
  for (const line of BY_PATH.get(path)!.split('\n')) {
    if (/^export abstract class /.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (line === '}') break;
    const bar = line.match(BAR);
    if (bar) { block = BARS.indexOf(bar[1]); continue; }
    const member = line.match(MEMBER);
    if (member && !['return', 'const', 'if', 'for'].includes(member[1])) found.set(member[1], block);
  }
  return found;
}

const members = new Map([...membersOf('elements/NodeUi.ts'), ...membersOf('elements/WidgetUi.ts')]);
const runTime = [...members].filter(([, block]) => block === 1).map(([name]) => name);

function resolveSpec(fromPath: string, spec: string): string | null {
  const parts = fromPath.split('/').slice(0, -1).concat(spec.split('/'));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop(); else stack.push(part);
  }
  const base = stack.join('/');
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => BY_PATH.has(candidate)) ?? null;
}

function reachableFromTheTool(): string[] {
  const seen = new Set<string>();
  const queue = ['runtime/main.tsx'];
  while (queue.length) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const match of (BY_PATH.get(path) ?? '').matchAll(/from\s+'((?:\.|@\/)[^']+)'/g)) {
      const resolved = match[1].startsWith('@/') ? resolveSpec('', match[1].slice(2)) : resolveSpec(path, match[1]);
      if (resolved) queue.push(resolved);
    }
  }
  return [...seen];
}

describe('a Ui', () => {
  it('puts every member under one of the three bars', () => {
    expect([...members].filter(([, block]) => block < 0).map(([name]) => name)).toEqual([]);
  });

  it('names as run time what a deployed tool draws with', () => {
    // `hasRuntimeWindow` is not among them any more, and not because it moved
    // to the other bar: it said what `NodeElement.hasInterface` already says,
    // and nothing held the two to each other. The page asks the engine
    // (`showsPage`). A list spelled out here is the right place to notice a
    // member leaving, which is why this line is part of the change.
    expect(runTime.sort()).toEqual(['View', 'clearValueAfterRun', 'ownsValue', 'showsResultWindow']);
  });
});

describe('a deployed tool', () => {
  it('asks a Ui for nothing that is build time', () => {
    // The store is shared with the editor, whose actions -- adding a node,
    // saving, opening a graph inside a node -- a tool has no button for.
    const SHARED_WITH_THE_EDITOR = ['store/graphStore.ts'];
    const asked: string[] = [];
    for (const path of reachableFromTheTool()) {
      if (/Ui\.ts$/.test(path) || SHARED_WITH_THE_EDITOR.includes(path)) continue;
      for (const match of BY_PATH.get(path)!.matchAll(/(?:NODE_UIS|WIDGET_UIS)\[[^\]]+\]\??\.(\w+)/g)) {
        if (!runTime.includes(match[1])) asked.push(`${path}: ${match[1]}`);
      }
    }
    expect(asked).toEqual([]);
  });
});
