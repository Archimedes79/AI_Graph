import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import type { ElementGeneration } from '@/authoring/generation';
import { selectorGeneration } from '@/authoring/selectorGeneration';
import { listAsRun } from '@/authoring/readAsRun';
import { continuing } from '@/store/portRenames';
import { InputNodeRunner } from '@engine/elements/nodes/input/InputNodeRunner.ts';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const INPUT = new InputNodeRunner();

const mode = (node: GraphNode): string => String(node.config.input_mode ?? 'text');

/** The port each mode hands its text on: what was typed, or what the file says. A folder hands on none. */
const TEXT_PORT: Record<string, string> = { text: 'output', file: 'content' };

/**
 * The file a file input reads, as a sample: the path it is set to, or else
 * the example file attached to it by an older version of this dialog, which
 * was meant for exactly this and reached nobody.
 */
function fileRead(node: GraphNode): string {
  return String(node.config.value ?? '').trim() || String(node.config.example_file ?? '').trim();
}

/** What an older version of this dialog let a person say the files contain; nothing asks for it now. */
function saidBefore(node: GraphNode): string {
  return String(node.config.output_format_prompt ?? '').trim();
}

export class InputNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'input';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Input';

  readonly hint = 'A value from outside the graph: typed text, one file, or a directory listing';

  readonly icon = '📥';

  readonly color = 'var(--ui-node-input, #1e3a5f)';

  override readonly Panel = lazy(() => import('./InputNodePanel'));

  override readonly generation: ElementGeneration<GraphNode> = selectorGeneration(INPUT.generation(), {
    isFolder: (node) => mode(node) === 'directory',
    selectsAll: (node) => this.selectsAll(node),
    bodyHeight: 140,
    // An older node may still say what its files contain: a selector may pick
    // by content, so it is told -- as what the files hold, not as the format
    // of what it returns (which is a list of paths, and the contract says so).
    context: (node) => (saidBefore(node) ? `The files in this folder contain: ${saidBefore(node)}` : ''),
    // The selector is handed the folder's listing, and that listing is its
    // example: the one the engine makes, fetched when ✨ is pressed.
    fetchSample: async (node) => {
      if (!String(node.config.value ?? '').trim()) return undefined;
      return { values: { files: await listAsRun(node) }, origin: `the listing of ${String(node.config.value)}` };
    },
  });

  /**
   * Whether a run takes every file the folder lists, and runs no selector:
   * the engine's answer, as the folder picker on a page asks it.
   */
  selectsAll(node: GraphNode): boolean {
    return INPUT.config(node).selectAll;
  }

  /**
   * A file or a folder is a guess until there is one to read: a default path,
   * which is what every node after it is then shown. Text is its own example,
   * and a fed input takes its path from upstream.
   */
  override missingExample(node: GraphNode, fed: boolean): boolean {
    if (fed || mode(node) === 'text') return false;
    return !fileRead(node);
  }

  /** Text typed into it is what it hands on; a file input hands on the path it is set to. */
  override restingValue(node: GraphNode, port: string): unknown {
    const text = node.config.value;
    if (mode(node) === 'text') return port === 'output' && typeof text === 'string' && text.trim() ? text : undefined;
    if (mode(node) === 'file' && port === 'path') return fileRead(node) || undefined;
    return undefined;
  }

  /** A file input's content is the text of its file: what every node after it is shown before any run. */
  override restingFile(node: GraphNode, port: string): string | undefined {
    return mode(node) === 'file' && port === 'content' ? fileRead(node) || undefined : undefined;
  }

  /**
   * Switched between text and one file, the text it hands on is still text --
   * typed, or read from the file -- so the wire from one mode's text port moves
   * onto the other's. It moved by accident once, when ports were matched by
   * position, and a person switching to a file meant the same nodes to read it.
   * A folder hands on paths, which is a different thing: no wire follows there.
   */
  override continuePorts(before: GraphNode, after: GraphNode): GraphNode {
    const was = TEXT_PORT[mode(before)];
    const now = TEXT_PORT[mode(after)];
    return was && now && was !== now ? continuing(before, after, { outputs: { [now]: was } }) : after;
  }

  /** Its old words describe what the files hold, not what the selector returns. */
  override outputFormatFor(): string {
    return '';
  }

  override describeOutput(node: GraphNode): string {
    // Per port, because a file input offers two things and code written for
    // the path when it is handed the content reads a CSV as a file name.
    const base = mode(node) === 'directory'
      ? 'port "Files" carries a list of file paths, port "Count" how many there are'
      : mode(node) === 'file' ? 'port "Content" carries the file\'s text (already read), port "Path" its path' : 'text';
    // What an older dialog let a person say the files contain is kept, and
    // said here: the box promised every node downstream would read it, and
    // none did.
    return mode(node) !== 'text' && saidBefore(node) ? `${base}; the files contain: ${saidBefore(node)}` : base;
  }

}
