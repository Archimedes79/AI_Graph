// What is wrong with a project folder, and the `check` command's answer.
//
// What a graph gets wrong is `check.ts`'s, which reads no disk -- so the
// editor asks it too, of a graph before it is loaded. What only a folder can
// get wrong, and reading one to check it, is here.

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { Graph } from '../graph.ts';
import { names, type Problem } from '../execution/wiring.ts';
import { registry } from '../elements/registry.ts';
import { INTERFACE_FILE } from './interfaceFile.ts';
import {
  FLOW_FILE, LAYOUT_FILE, NODE_FILE, NODES_DIR, isProjectFolder, loadGraph, nodeFolder, projectFolderOf, projectTexts, readStructure,
} from './folder.ts';
import { problemsIn } from './check.ts';

/**
 * What only a project folder can get wrong: a folder under `nodes/` that
 * belongs to no node (the node was deleted, or renamed in `flow.json` by
 * hand), and a file in a node's folder that nothing reads -- `instructions.md`
 * where an AI node reads `prompt.md` is a text somebody wrote and nobody will
 * ever send.
 */
export async function folderProblems(folder: string): Promise<Problem[]> {
  const { graph } = await readStructure(folder);
  const found: Problem[] = [];
  const expected = new Map<string, Set<string>>();
  for (const text of projectTexts(graph)) {
    const slash = text.path.lastIndexOf('/');
    const dir = text.path.slice(0, slash);
    if (!expected.has(dir)) expected.set(dir, new Set());
    expected.get(dir)!.add(text.path.slice(slash + 1));
  }
  // Every node has a folder it may use, even one that keeps no writing yet.
  for (const node of graph.nodes) {
    const nodeDir = nodeFolder(node.id);
    if (!expected.has(nodeDir)) expected.set(nodeDir, new Set());
    // Its name and settings, and what goes in and what comes out.
    expected.get(nodeDir)!.add(NODE_FILE).add(INTERFACE_FILE);
  }

  // A node that holds a graph holds a project folder: its own flow.json and
  // layout.json belong there, and what is under them is that project's, looked
  // at below by the same function.
  const nested = new Set<string>();
  for (const node of graph.nodes) {
    if (!registry.node(node.node_type)?.nestedGraph(node)) continue;
    const dir = nodeFolder(node.id);
    nested.add(dir);
    // Every node's folder is in `expected` already, from the loop above.
    for (const name of [FLOW_FILE, LAYOUT_FILE]) expected.get(dir)!.add(name);
  }

  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(join(folder, relative), { withFileTypes: true });
    } catch {
      return;
    }
    const reads = expected.get(relative);
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      // Its own project: checked as one, not walked as part of this one. A
      // `nodes/` there without a flow.json is read by nobody, and said below.
      if (entry.isDirectory() && entry.name === NODES_DIR && nested.has(relative) && isProjectFolder(join(folder, relative))) {
        found.push(...(await folderProblems(join(folder, relative)))
          .map((problem) => ({ ...problem, where: `${relative}/${problem.where}` })));
        continue;
      }
      if (entry.isDirectory()) {
        const owned = [...expected.keys()].some((dir) => dir === path || dir.startsWith(`${path}/`));
        if (!owned) {
          found.push({
            where: path,
            problem: 'This folder belongs to no node in flow.json.',
            fix: 'Delete it, or give the node it was for this id again.',
          });
          continue;
        }
        await walk(path);
      } else if (reads && !reads.has(entry.name) && !entry.name.startsWith('.')) {
        found.push({
          where: path,
          problem: 'Nothing reads this file.',
          fix: reads.size ? `This element reads ${names(reads)}.` : 'This element keeps no writing in files.',
        });
      }
    }
  };
  if (existsSync(join(folder, NODES_DIR))) await walk(NODES_DIR);
  return found;
}

/** Everything wrong with the graph or project at *path*: the `check` command's answer. */
export async function checkPath(path: string): Promise<{ problems: Problem[]; graph: Graph | null }> {
  let graph: Graph;
  try {
    graph = await loadGraph(path);
  } catch (error) {
    return { problems: [{ where: path, problem: (error as Error).message, fix: 'Fix the file so it can be read.' }], graph: null };
  }
  const problems = problemsIn(graph);
  const folder = projectFolderOf(path);
  if (folder) problems.push(...await folderProblems(folder));
  return { problems, graph };
}
