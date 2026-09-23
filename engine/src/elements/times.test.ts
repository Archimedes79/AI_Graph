import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { registry } from './registry.ts';
import type { GraphNode } from '../graph.ts';

/**
 * Build time and run time, kept apart inside one class.
 *
 * An element is one class per kind, and it carries both what a run asks of it
 * and what only building asks -- how an AI writes its body, what `check` says
 * about it, what a bundle must carry. The second kind travels into a deployed
 * tool with the class; that is accepted, because a second class per kind would
 * cost more than the bytes. What is *not* accepted is the two running together:
 *
 * - the base classes say which is which, under three bars;
 * - every kind keeps that order, with its build-time members under a bar;
 * - nothing a run calls reaches a build-time member.
 *
 * The bars are therefore load-bearing: this file reads them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const BARS = ['What it is', 'Run time', 'Build time'];
const BAR = /^ {2}\/\/ ── (What it is|Run time|Build time) ─+$/;

interface Member { name: string; block: number; line: number }

/** The members of the first class in *file*, each with the bar it stands under (-1: none). */
function membersOf(file: string): Member[] {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let found: ts.ClassDeclaration | undefined;
  ts.forEachChild(source, (node) => { if (ts.isClassDeclaration(node) && !found) found = node; });
  if (!found) return [];
  const first = source.getLineAndCharacterOfPosition(found.getStart()).line;
  return found.members.flatMap((member) => {
    if (!member.name || !ts.isIdentifier(member.name)) return [];
    const line = source.getLineAndCharacterOfPosition(member.getStart()).line;
    let block = -1;
    for (let at = first; at < line; at += 1) {
      const bar = lines[at].match(BAR);
      if (bar) block = BARS.indexOf(bar[1]);
    }
    return [{ name: member.name.text, block, line: line + 1 }];
  });
}

const BASES = ['ElementRunner.ts', 'NodeRunner.ts', 'WidgetRunner.ts'].map((name) => join(HERE, name));
const blockOf = new Map<string, number>();
for (const file of BASES) for (const member of membersOf(file)) blockOf.set(member.name, member.block);
const buildTime = [...blockOf].filter(([, block]) => block === 2).map(([name]) => name);

function kinds(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return kinds(path);
    return /Runner\.ts$/.test(name) ? [path] : [];
  });
}

describe('the base classes', () => {
  it('put every member under one of the three bars', () => {
    for (const file of BASES) {
      const loose = membersOf(file).filter((member) => member.block < 0).map((member) => member.name);
      expect(loose, `${file}: not under a bar`).toEqual([]);
    }
  });

  it('name as build time what only building asks', () => {
    // Said here in full, so that making something build time -- or taking it
    // out -- is a decision somebody made, not a bar that moved.
    expect(buildTime.sort()).toEqual(['asksModel', 'deployNeeds', 'engineRuns', 'generation', 'graphAuthorNote', 'problems', 'receives', 'referencedPaths', 'whatRuns']);
  });
});

describe('every kind', () => {
  const files = [...kinds(join(HERE, 'nodes')), ...kinds(join(HERE, 'widgets'))];

  it.each(files.map((file) => [file.slice(HERE.length + 1).split('\\').join('/'), file]))('%s keeps the order of its base', (_name, file) => {
    const known = membersOf(file).filter((member) => blockOf.has(member.name));
    const order = known.map((member) => blockOf.get(member.name)!);
    expect(order, known.map((member) => member.name).join(', ')).toEqual([...order].sort((a, b) => a - b));
    // What is build time stands under the bar that says so.
    const unmarked = known.filter((member) => blockOf.get(member.name) === 2 && member.block !== 2).map((member) => member.name);
    expect(unmarked, 'build-time members above the "Build time" bar').toEqual([]);
    const misplaced = known.filter((member) => blockOf.get(member.name)! < 2 && member.block === 2).map((member) => member.name);
    expect(misplaced, 'run-time members under the "Build time" bar').toEqual([]);
  });
});

/**
 * The build-time members *read* in a piece of source: `x.generation`, `this.problems(...)`.
 * Read from the syntax tree, not matched as text -- `...problems.map(` spreads a
 * local called `problems`, and a comment may say whatever it likes.
 */
function reaches(text: string, from?: { pos: number; end: number }): string[] {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    const inside = !from || (node.getStart() >= from.pos && node.end <= from.end);
    if (inside && ts.isPropertyAccessExpression(node) && buildTime.includes(node.name.text)) found.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

describe('what a run calls', () => {
  // The run, and everything a served tool does with a graph it holds. All of
  // `execution/` but `examples.ts`, which is the `test` command: building.
  const RUN_TIME = [
    ...readdirSync(join(SRC, 'execution')).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && name !== 'examples.ts')
      .map((name) => `execution/${name}`),
    'elements/body.ts', 'elements/fileSelection.ts', 'authoring/logic.ts',
    'host/serve.ts', 'host/runs.ts', 'host/rounds.ts', 'host/schedule.ts', 'host/node.ts',
  ];

  it.each(RUN_TIME)('%s reaches nothing that is build time', (path) => {
    const file = join(SRC, path);
    expect(existsSync(file), `${path} has moved: name its new place here`).toBe(true);
    expect(reaches(readFileSync(file, 'utf8'))).toEqual([]);
  });

  // The other half, and the one a list of files cannot hold: inside a kind's own
  // class, what stands above its "Build time" bar is what a run calls. A
  // build-time member may ask a run-time one; never the other way.
  const classes = [...BASES, ...kinds(join(HERE, 'nodes')), ...kinds(join(HERE, 'widgets'))];
  it.each(classes.map((file) => [file.slice(HERE.length + 1).split('\\').join('/'), file]))('%s: nothing above the "Build time" bar reaches below it', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const blocks = new Map(membersOf(file).map((member) => [member.name, member.block]));
    const crossing: string[] = [];
    ts.forEachChild(source, (node) => {
      if (!ts.isClassDeclaration(node)) return;
      for (const member of node.members) {
        const name = member.name && ts.isIdentifier(member.name) ? member.name.text : '';
        if (!name || (blocks.get(name) ?? blockOf.get(name)) === 2) continue;
        for (const reached of reaches(text, { pos: member.getStart(), end: member.end })) crossing.push(`${name} -> ${reached}`);
      }
    });
    expect(crossing).toEqual([]);
  });
});

describe('what runs', () => {
  const node = (type: string, config: Record<string, unknown> = {}): GraphNode => ({
    id: 'n', node_type: type as GraphNode['node_type'], label: 'N', description: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], config,
  });

  it.each(registry.nodeTypes())('is said by a %s node, and is there', (type) => {
    const element = registry.node(type)!;
    const subject = node(type);
    const runs = element.whatRuns(subject);
    expect(runs.does.length).toBeGreaterThan(20);
    if (runs.where.startsWith('engine/')) {
      const [file, method] = runs.where.split(' › ');
      const path = resolve(SRC, '..', '..', file);
      expect(existsSync(path), `${file} does not exist`).toBe(true);
      expect(readFileSync(path, 'utf8')).toMatch(new RegExp(`\\b${method}\\(`));
    } else {
      // A body: one of the files this element keeps in its folder.
      expect(element.texts(subject).map((text) => text.file)).toContain(runs.where);
    }
  });

  it('never reads a class\'s name at run time: in the editor\'s bundle a class is called `Kg`', () => {
    for (const file of [...BASES, ...kinds(join(HERE, 'nodes'))]) expect(readFileSync(file, 'utf8'), file).not.toMatch(/constructor\.name\b(?!`)/);
  });

  it('names a file that is there, and only a body that does run', () => {
    const element = registry.node('input')!;
    const folder = (config: Record<string, unknown>) => node('input', { input_mode: 'directory', selector_code: 'function run({ files }) { return { files }; }', ...config });
    // A sentence may name a file in the node's folder: then the node keeps one of that name.
    for (const subject of [folder({ select_all_files: false }), folder({ select_all_files: true })]) {
      const kept = element.texts(subject).map((text) => text.file);
      for (const named of element.whatRuns(subject).does.match(/\b[\w.-]+\.(?:js|md|json)\b/g) ?? []) expect(kept).toContain(named);
    }
    // With "select all" ticked the body that chooses is not run, so it is not said to be.
    expect(element.whatRuns(folder({ select_all_files: false })).does).toContain('select.js');
    expect(element.whatRuns(folder({ select_all_files: true })).does).not.toContain('select.js');
  });

  it('follows an ai node from the engine\'s call to a body once run.js is changed', () => {
    const element = registry.node('ai')!;
    expect(element.whatRuns(node('ai'))).toMatchObject({ by: 'engine', where: 'run.js' });
    expect(element.whatRuns(node('ai', { run_code: 'async function run() { return { output: "mine" }; }' }))).toMatchObject({ by: 'body', where: 'run.js' });
  });
});
