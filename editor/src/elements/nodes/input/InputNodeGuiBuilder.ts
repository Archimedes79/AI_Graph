import { lazy } from 'react';
import type { GraphNode } from '@/graph';
import { NodeGuiBuilder } from '../../NodeGuiBuilder';

const listsFolder = (node: GraphNode): boolean => node.config.input_mode === 'directory';

export class InputNodeGuiBuilder extends NodeGuiBuilder {
  readonly nodeType = 'input';

  // ── Build time ────────────────────────────────────────────────────────────

  readonly label = 'Input';

  readonly hint = 'A value from outside the graph: a text, or a folder listing';

  readonly icon = '📥';

  readonly color = 'var(--ui-node-input, #1e3a5f)';

  override readonly Panel = lazy(() => import('./InputNodePanel'));

  /**
   * A folder is a guess until there is one to list: a default path, which is
   * what every node after it is then shown. Text is its own example, and a
   * fed input takes its path from upstream.
   */
  override missingExample(node: GraphNode, fed: boolean): boolean {
    return !fed && listsFolder(node) && !String(node.config.value ?? '').trim();
  }

  /**
   * Text typed into it is what it hands on -- a path too, which the node it is
   * wired into reads when that input says "Read the file at this path".
   */
  override restingValue(node: GraphNode, port: string): unknown {
    const text = node.config.value;
    return !listsFolder(node) && port === 'output' && typeof text === 'string' && text.trim() ? text : undefined;
  }

  override describeOutput(node: GraphNode): string {
    return listsFolder(node) ? 'port "Files" carries a list of file paths, port "Count" how many there are' : 'text';
  }

}
