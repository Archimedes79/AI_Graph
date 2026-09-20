import { describe, it, expect } from 'vitest';

/**
 * Build time and run time in a builder, the mirror of the engine's
 * `elements/times.test.ts`.
 *
 * A builder is one class per kind, and its name now says what the bars below
 * once had to: `GuiBuilder` is build time, all of it. That was not always so --
 * it used to also carry what a deployed tool draws with (`View`, a few flags),
 * and the second kind travels into a tool with the class whether it is used
 * there or not. So the base classes still say which is which under three bars,
 * and this file checks that the run-time side of them has stayed empty.
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

const members = new Map([...membersOf('elements/NodeGuiBuilder.ts'), ...membersOf('elements/WidgetGuiBuilder.ts')]);
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

describe('a builder', () => {
  it('puts every member under one of the three bars', () => {
    expect([...members].filter(([, block]) => block < 0).map(([name]) => name)).toEqual([]);
  });

  it('has no run-time members at all: a GuiBuilder is the builder, whole', () => {
    // It once had four. Each left for a home that says what it is:
    //
    //   View, ownsValue          page/blocks.ts — what the page draws
    //   showsResultWindow        nodeKinds.ts   — what a node is, loaded and saved
    //   clearValueAfterRun       WidgetRunner   — what a run means for a block
    //
    // Which is the stronger claim, and the one worth holding: not "a tool may
    // not *call* these", but "a tool never loads this class". The bars below
    // are still what says which is which; there is simply nothing left on the
    // run-time side of them. `runtime/boundary.test.ts` holds the other half —
    // that neither registry is reachable from the tool's entry point.
    expect(runTime.sort()).toEqual([]);
  });
});

describe('a deployed tool', () => {
  it('asks a builder for nothing at all', () => {
    // No exception any more. There used to be one, for `store/graphStore.ts`,
    // on the grounds that the store is shared with the editor and a tool has
    // no button for adding a node or saving. Half of that was true and the
    // half that was not is the whole point: `create` runs on every *load* and
    // `saved` on every run, both of which a delivered tool does. So the one
    // module both hosts share was the one allowed to reach into the builder,
    // and reaching in is what put the builder in the bundle.
    //
    // Those three facts are `nodeKinds.ts` now — what a node *is*, which is
    // neither drawing nor building — and the store asks that instead.
    const asked: string[] = [];
    for (const path of reachableFromTheTool()) {
      if (/GuiBuilder\.ts$/.test(path)) continue;
      for (const match of BY_PATH.get(path)!.matchAll(/(?:NODE_BUILDERS|WIDGET_BUILDERS)\[[^\]]+\]\??\.(\w+)/g)) {
        asked.push(`${path}: ${match[1]}`);
      }
    }
    expect(asked).toEqual([]);
  });
});
