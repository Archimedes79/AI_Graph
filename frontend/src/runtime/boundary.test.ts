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
 * than in a naming convention or a review habit.
 *
 * The sources are read through `import.meta.glob` rather than `node:fs`, so the
 * test needs no Node types and runs under the same config as everything else.
 */

// Rooted at /src, not relative: a relative pattern from inside src/runtime
// silently omits src/runtime itself, and the walker then starts nowhere.
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Glob keys come back as /src/…; make them relative to `src`. */
const BY_PATH = new Map(
  Object.entries(SOURCES).map(([key, source]) => [key.replace(/^\/src\//, ''), source]),
);

/** Modules that exist for *building* a graph, and have no business in a bundle. */
const EDITOR_ONLY = [
  'components/gui/DesignerTab',
  'components/gui/DesignerSurface',
  'components/gui/DesignerPalette',
  'components/gui/PreviewTab',
  'components/GuiWidgetEditor',
  'components/GraphCanvas',
  'components/NodeEditor',
  'components/Sidebar',
  'components/Toolbar',
  'components/ViewTabs',
  'App',
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

/** Every module the runtime entry point can reach. */
function runtimeImports(): Set<string> {
  const seen = new Set<string>();
  const queue = ['runtime/main.tsx'];

  while (queue.length) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);

    const source = BY_PATH.get(path);
    if (!source) continue;
    // Relative specifiers only: a package from node_modules cannot reach back
    // into this source tree, so it cannot drag an editor module in with it.
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      const resolved = resolveSpec(path, match[1]);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

describe('deployment boundary', () => {
  const reachable = runtimeImports();

  it('reaches the page a deployed tool renders', () => {
    // A check on the walker itself: without it, the assertions below could pass
    // because nothing was found rather than because nothing is wrong.
    expect(BY_PATH.has('runtime/main.tsx')).toBe(true);
    expect(reachable.has('runtime/RuntimeApp.tsx')).toBe(true);
    expect(reachable.has('components/gui/GuiPage.tsx')).toBe(true);
    expect(reachable.size).toBeGreaterThan(10);
  });

  it.each(EDITOR_ONLY)('does not pull %s into a deployed bundle', (module) => {
    const hit = [...reachable].find((path) => path.replace(/\.tsx?$/, '') === module);
    expect(hit, `${module} is reachable from runtime/main.tsx`).toBeUndefined();
  });
});
