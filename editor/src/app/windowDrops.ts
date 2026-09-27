// What is dropped anywhere on the editor's window: a graph to open.
//
// The window listens rather than the canvas, so that a file dropped a hair
// outside the canvas is not the browser's, which would open it and take the
// unsaved graph with it (`App.tsx`). What lands on a node or on an example box
// is theirs, and never arrives there; what lands in a code box does, and is
// the box's all the same.

import { call } from '@/api/client';
import { CODE_FIELD } from '@/authoring/CodeField';

/**
 * Whether a drop landed in a code box (`CodeField`) -- a node's body, in its
 * dialog or enlarged. Its editor types the text of a file dropped into it in,
 * where it was dropped, and lets the drop go on to the window, which took the
 * file for a graph to open as well: a .json one replaced the graph, anything
 * else was said to be no graph file.
 */
export function landedInCodeField(target: EventTarget | null): boolean {
  return !!(target as Partial<Element> | null)?.closest?.(CODE_FIELD);
}

/** How a dropped folder is looked for (`findProjects`): the projects found, and where it looked, in words. */
type FindProjects = (name: string) => Promise<{ paths: string[]; searched: string }>;

const findProjects: FindProjects = (name) => call('findProjects', { name });

/**
 * Where the project folder *name*, dropped onto the window, is: a browser says
 * a dropped folder's name and never where it is, so the engine looks for the
 * one project of that name. None, or several, is said -- none with where the
 * engine looked -- with the way that always works.
 */
export async function droppedProject(name: string, find: FindProjects = findProjects): Promise<string> {
  const { paths, searched } = await find(name);
  if (paths.length === 1) return paths[0];
  throw new Error(paths.length
    ? `${paths.length} projects are called "${name}". Open the one you mean with 📂 Open.`
    : `A browser does not say where a dropped folder is, and no project called "${name}" is in ${searched}. Open it with 📂 Open.`);
}
