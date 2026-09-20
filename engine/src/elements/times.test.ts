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

const BASES = ['Element.ts', 'NodeElement.ts', 'WidgetElement.ts'].map((name) => join(HERE, name));
const blockOf = new Map<string, number>();
for (const file of BASES) for (const member of membersOf(file)) blockOf.set(member.name, member.block);
const buildTime = [...blockOf].filter(([, block]) => block === 2).map(([name]) => name);

function kinds(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return kinds(path);
    return /Element\.ts$/.test(name) ? [path] : [];
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
    expect(buildTime.sort()).toEqual(['asksModel', 'deployNeeds', 'engineRuns', 'generation', 'problems', 'referencedPaths', 'whatRuns']);
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

describe('what a run calls', () => {
  // The run, and everything a served tool does with a graph it holds.
  const RUN_TIME = [
    'execution/executor.ts', 'execution/batching.ts', 'execution/fileInputs.ts', 'execution/latch.ts', 'execution/reuse.ts',
    'execution/triggers.ts', 'execution/runtimeValues.ts', 'elements/body.ts', 'authoring/logic.ts',
    'host/serve.ts', 'host/runs.ts', 'host/rounds.ts', 'host/schedule.ts', 'host/node.ts',
  ];

  it.each(RUN_TIME)('%s reaches nothing that is build time', (path) => {
    const file = join(SRC, path);
    expect(existsSync(file), `${path} has moved: name its new place here`).toBe(true);
    const text = readFileSync(file, 'utf8');
    const reached = buildTime.filter((name) => new RegExp(`\\.${name}\\b`).test(text));
    expect(reached).toEqual([]);
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

  it('follows an ai node from the engine\'s call to a body once run.js is changed', () => {
    const element = registry.node('ai')!;
    expect(element.whatRuns(node('ai'))).toMatchObject({ by: 'engine', where: 'run.js' });
    expect(element.whatRuns(node('ai', { run_code: 'async function run() { return { output: "mine" }; }' }))).toMatchObject({ by: 'body', where: 'run.js' });
  });
});
