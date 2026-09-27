import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { continuing } from '@/store/portRenames';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const mode = (node: GraphNode): string => String(node.config.input_mode ?? 'text');

/** The port each mode hands its text on: what was typed, or what the file says. A folder hands on none. */
const TEXT_PORT: Record<string, string> = { text: 'output', file: 'content' };

/** What a file or folder input reads, as a sample: the path it is set to. */
function fileRead(node: GraphNode): string {
  return String(node.config.value ?? '').trim();
}

export class InputNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'input';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Input';

  readonly hint = 'A value from outside the graph: typed text, one file, or a directory listing';

  readonly icon = '📥';

  readonly color = 'var(--ui-node-input, #1e3a5f)';

  override readonly Panel = lazy(() => import('./InputNodePanel'));

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

  override describeOutput(node: GraphNode): string {
    // Per port, because a file input offers two things and code written for
    // the path when it is handed the content reads a CSV as a file name.
    return mode(node) === 'directory'
      ? 'port "Files" carries a list of file paths, port "Count" how many there are'
      : mode(node) === 'file' ? 'port "Content" carries the file\'s text (already read), port "Path" its path' : 'text';
  }

}
