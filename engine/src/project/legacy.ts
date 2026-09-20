// Graphs saved before projects were folders.
//
// For a while a single `my_graph.json` could keep a node's body in a file
// beside it: `config.code_file: "Analyse.js"` pointing into `my_graph.nodes/`,
// with an empty body in the JSON. Such a graph still opens -- the body is read
// back in, and the pointer dropped -- and saving it as a project folder is the
// way forward. Nothing writes this layout any more.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import type { Graph } from '../graph.ts';
import { registry } from '../elements/registry.ts';
import { parseWidget } from '../elements/nodes/gui/GuiNodeRunner.ts';

/** The body of a legacy node file: its generated header, if it has one, taken off. */
export function legacyBody(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let start = 0;
  if (lines[0]?.includes('--- ai-graph ---')) {
    start = lines.findIndex((line, index) => index > 0 && /^\/\/\s*-+\s*$/.test(line.trim())) + 1;
  } else if (lines[0]?.trim() === '---') {
    start = lines.findIndex((line, index) => index > 0 && line.trim() === '---') + 1;
  }
  return lines.slice(Math.max(start, 0)).join('\n').replace(/^\n+|\n+$/g, '');
}

/** Read every `code_file` body back into *graph*, which was read from *graphPath*. */
export async function readLegacyNodeFiles(graph: Graph, graphPath: string): Promise<void> {
  const name = basename(graphPath, extname(graphPath));
  const folder = join(dirname(graphPath), `${name}.nodes`);
  const fill = async (holder: Record<string, unknown>, bodyField: string | undefined, subfolder: string) => {
    const file = String(holder.code_file ?? '').trim();
    if (!file) return;
    delete holder.code_file;
    const path = join(subfolder, file);
    if (bodyField && existsSync(path)) holder[bodyField] = legacyBody(await readFile(path, 'utf8'));
  };

  for (const node of graph.nodes) {
    await fill(node.config, registry.node(node.node_type)?.logic(node)?.fields.body, folder);
    const blocks = Array.isArray(node.config.gui_widgets) ? node.config.gui_widgets as Record<string, unknown>[] : [];
    for (const raw of blocks) {
      const widget = parseWidget(raw);
      // A page's blocks were kept one folder down, named after the page.
      const pageFolder = join(folder, node.label.replace(/[^\p{L}\p{N}_\-. ]/gu, '').trim().replace(/[\s.]+/g, '_') || 'node');
      await fill(raw, registry.widget(widget.kind)?.logic(widget)?.fields.body, pageFolder);
    }
  }
}
