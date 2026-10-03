import { describe, it, expect } from 'vitest';

/**
 * The deployment boundary, asserted on the import graph.
 *
 * A deployed tool is built from `runtime.html` → `runtime/main.tsx`. Whatever
 * that entry point can reach, transitively, is in the bundle a recipient
 * downloads; whatever it cannot reach is not there at all. That distinction is
 * why the editing affordances moved out of the page component instead of being
 * switched off with a flag: a flag that is false at runtime leaves the code in
 * the bundle, and the deployed tool really was shipping the palette, the drag
 * grip and the properties panel inside a chunk it loaded and never used.
 *
 * So the rule is checked where it is actually decided — in the imports, rather
 * than in a naming convention or a review habit. The walk starts from every
 * file of `runtime/`, not only the entry point: one that nothing imports yet is
 * held to the same rule before it is wired in. It follows imports through
 * every area, which the editor's layer rule (`layers.test.ts`) cannot: that one
 * sees a single import at a time, and `runtime` ranks above the store. And it
 * follows them into the engine, where the page is held to load nothing that
 * runs a graph. An import of types only is erased and ships nothing, so it is
 * not followed.
 *
 * The sources are read through `import.meta.glob` rather than `node:fs`, so the
 * test needs no Node types and runs under the same config as everything else.
 */

// Rooted at /src, not relative: a relative pattern from inside src/runtime
// silently omits src/runtime itself, and the walker then starts nowhere.
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// The engine, beside the editor rather than inside it.
const ENGINE_SOURCES = import.meta.glob('../../../engine/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Every source by its path: the editor's relative to `src`, the engine's as `@engine/<path>`, as it is imported. */
const BY_PATH = new Map([
  ...Object.entries(SOURCES).map(([key, source]) => [key.replace(/^\/src\//, ''), source] as const),
  ...Object.entries(ENGINE_SOURCES).map(([key, source]) => [key.replace(/^(\.\.\/)+engine\/src\//, '@engine/'), source] as const),
]);

/**
 * The modules *source* loads code from: the editor's (`.` and `@/`) and the
 * engine's (`@engine/`) -- a package cannot reach back into these trees, so it
 * cannot drag a module of them in. An import of types only ships nothing.
 */
function loads(source: string): string[] {
  const specs: string[] = [];
  for (const [, clause, spec] of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s*from\s+'((?:\.|@\/|@engine\/)[^']+)'/g)) {
    const names = /^\{([^}]*)\}$/.exec(clause.trim())?.[1];
    const typesOnly = /^type\b/.test(clause.trim())
      || (names !== undefined && names.split(',').map((name) => name.trim()).filter(Boolean).every((name) => name.startsWith('type ')));
    if (!typesOnly) specs.push(spec);
  }
  return specs;
}

/**
 * The editor's areas a tool has no part of at all: it holds no graph (the
 * store), draws no canvas, writes no node (authoring) and has no editor
 * around it (app). The server holds the graph; the page is handed its blocks.
 */
const EDITOR_AREAS = ['store', 'canvas', 'authoring', 'app'];

/** Modules for *building* a graph in the areas a tool shares with the editor -- the page -- and the editor's shell. */
const EDITOR_ONLY = [
  'App',
  'page/DesignerTab',
  'page/DesignerSurface',
  'page/DesignerPalette',
  'page/ApplicationView',
  'page/WidgetEditor',
];

function resolveSpec(fromPath: string, spec: string): string | null {
  const parts = fromPath.split('/').slice(0, -1).concat(spec.split('/'));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (BY_PATH.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Every module the runtime area reaches -- what a deployed tool is built from
 * -- each with the module that first imported it, or null for one of its own.
 */
function runtimeImports(): Map<string, string | null> {
  const reachedBy = new Map<string, string | null>();
  // Breadth first, so the way a module is said to be reached is a shortest one.
  const queue: [string, string | null][] = [...BY_PATH.keys()]
    .filter((path) => path.startsWith('runtime/') && !/\.test\.tsx?$/.test(path))
    .map((path) => [path, null]);

  while (queue.length) {
    const [path, by] = queue.shift()!;
    if (reachedBy.has(path)) continue;
    reachedBy.set(path, by);

    const source = BY_PATH.get(path);
    if (!source) continue;
    for (const spec of loads(source)) {
      const resolved = spec.startsWith('@/') ? resolveSpec('', spec.slice(2))
        : spec.startsWith('@engine/') ? resolveSpec('', spec)
          : resolveSpec(path, spec);
      if (resolved) queue.push([resolved, path]);
    }
  }
  return reachedBy;
}

describe('deployment boundary', () => {
  const reachedBy = runtimeImports();
  const reachable = new Set(reachedBy.keys());
  /** How *path* is reached: each import on the way, from a file of `runtime/`. */
  const chain = (path: string): string => {
    const links = [path];
    for (let by = reachedBy.get(path); by; by = reachedBy.get(by)) links.unshift(by);
    return links.join(' → ');
  };

  it('reaches the page a deployed tool renders', () => {
    // A check on the walker itself: without it, the assertions below could pass
    // because nothing was found rather than because nothing is wrong.
    expect(BY_PATH.has('runtime/main.tsx')).toBe(true);
    expect(reachable.has('runtime/RuntimeApp.tsx')).toBe(true);
    expect(reachable.has('page/GuiPage.tsx')).toBe(true);
    expect(reachable.size).toBeGreaterThan(10);
  });

  it('draws elements with their views, and never loads a panel or the fields one is made of', () => {
    // Panels are registered with `lazy(() => import(…))`, which this walk --
    // like the bundler's static graph -- does not follow: a panel is a chunk
    // the editor fetches when an element is opened, and a tool never does.
    const editing = [...reachable].filter((path) => /Panel\.tsx$/.test(path) || /^elements\/fields\//.test(path));
    expect(editing.map(chain)).toEqual([]);
    expect([...reachable].some((path) => /WidgetView\.tsx$/.test(path))).toBe(true);
  });

  it.each(EDITOR_AREAS)('reaches nothing in %s/: a tool holds no graph, draws no canvas, writes no node, has no editor around it', (area) => {
    expect([...reachable].filter((path) => path.startsWith(`${area}/`)).map(chain)).toEqual([]);
  });

  it.each(EDITOR_ONLY)('does not pull %s into a deployed bundle', (module) => {
    const hit = [...reachable].find((path) => path.replace(/\.tsx?$/, '') === module);
    expect(hit && chain(hit), `${module} is reachable from runtime/`).toBeUndefined();
  });

  /**
   * The builders, as a whole rather than member by member: a tool never loads
   * a `GuiBuilder` class, nor either registry that hands them out. That is the
   * bytes being absent, not only the calls, so a member added to a
   * `GuiBuilder` tomorrow is kept out of a tool whichever bar it lands under
   * (`elements/times.test.ts` holds that the run-time bar is empty).
   *
   * It used to have one exception, `store/graphStore.ts`: a tool loaded its
   * graph into the editor's store, and loading and running reached into the
   * builders for what a node *is* (`document/nodeKinds.ts` since). A tool
   * holds no graph now -- the server does, and hands the page its blocks --
   * so the store is not in it at all.
   */
  it.each(['elements/registry.ts', 'elements/widgets/roster.ts'])(
    'does not pull the builder registry %s into a deployed bundle',
    (module) => {
      expect(reachable.has(module) ? chain(module) : null).toBeNull();
    },
  );

  it('never loads a GuiBuilder class, even one imported without the registry', () => {
    expect([...reachable].filter((path) => /GuiBuilder\.ts$/.test(path)).map(chain)).toEqual([]);
  });

  /**
   * The engine, as far as a tool's page loads it: the contract
   * (`host/api.ts`), and the shapes of a few values its views read -- a
   * chat's conversation, a dropdown's choice, a slider's range. Which blocks
   * start a round and which are given a value are the graph's events and
   * values, which the runtime API tells the page by name. It used to ask the
   * engine's element registry, and so loaded every runner, the executor and
   * the authoring code with it: fifty modules of the engine, for two answers.
   */
  it('loads of the engine only the contract and the shapes of the values its views read', () => {
    const engine = [...reachable].filter((path) => path.startsWith('@engine/'));
    expect(engine).toContain('@engine/host/api.ts');
    const more = engine.filter((path) => !/^@engine\/(host\/api\.ts|elements\/widgets\/[a-z_]+\/[a-z][A-Za-z]*\.ts)$/.test(path));
    expect(more.map(chain)).toEqual([]);
  });

  it('draws the page it is handed, and runs it through the session, from the halves that are delivered', () => {
    // The other side of the rules above: absent *because the page gets what it
    // needs elsewhere*, not because the page stopped working.
    expect(reachable.has('page/blocks.ts')).toBe(true);
    expect(reachable.has('api/session.ts')).toBe(true);
  });
});
