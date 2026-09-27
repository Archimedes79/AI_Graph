import { describe, it, expect } from 'vitest';

/**
 * Build time and run time in a builder: the bars of the engine's
 * `elements/times.test.ts`, mirrored.
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
    // Which is what lets the stronger claim be held: not "a tool may not
    // *call* these", but "a tool never loads this class". The bars below are
    // still what says which is which; there is simply nothing left on the
    // run-time side of them. `runtime/boundary.test.ts` holds the rest -- that
    // no GuiBuilder class and neither registry is reachable from the tool's
    // entry point.
    expect(runTime.sort()).toEqual([]);
  });
});
