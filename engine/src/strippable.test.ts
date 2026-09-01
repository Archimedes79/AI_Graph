import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The engine must run with no build step, anywhere.
 *
 * That is what makes a bundle a copy rather than a compilation: a recipient
 * runs `node engine/main.ts graph.json` and nothing is installed, generated or
 * transpiled. Node achieves it by *stripping* the types out — not compiling
 * them — so a handful of TypeScript features that need code emitted for them
 * are unavailable, and using one is an error that appears on the recipient's
 * machine and nowhere earlier.
 *
 * The first was `constructor(readonly status: number)`, found by running a
 * bundle from a temporary directory. This test is why the second will be found
 * here instead.
 */

const SRC = join(__dirname);

const FORBIDDEN: { pattern: RegExp; what: string; instead: string }[] = [
  {
    pattern: /constructor\s*\([^)]*\b(readonly|private|public|protected)\b/,
    what: 'a parameter property',
    instead: 'declare the field and assign it in the constructor body',
  },
  {
    pattern: /^\s*(export\s+)?(const\s+)?enum\s+\w+/m,
    what: 'an enum',
    instead: "a union of string literals, or an object with `as const`",
  },
  {
    pattern: /^\s*(export\s+)?namespace\s+\w+/m,
    what: 'a namespace',
    instead: 'a module — this is one already',
  },
  {
    pattern: /^\s*@\w+/m,
    what: 'a decorator',
    instead: 'a plain function call',
  },
];

async function engineSources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await engineSources(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

describe('every engine source survives type stripping', () => {
  it('uses nothing that Node would have to compile', async () => {
    const offences: string[] = [];

    for (const file of await engineSources(SRC)) {
      const source = await readFile(file, 'utf8');
      // Comments talk about these constructs on purpose; only code counts.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');

      for (const { pattern, what, instead } of FORBIDDEN) {
        if (pattern.test(code)) {
          offences.push(`${file.slice(SRC.length + 1)}: ${what} — ${instead}`);
        }
      }
    }

    expect(offences).toEqual([]);
  });
});
