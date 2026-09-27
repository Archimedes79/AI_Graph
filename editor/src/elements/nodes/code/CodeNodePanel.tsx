import NodeDefinition from '@/authoring/NodeDefinition';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/** A code node: its text, and what ✨ writes from it -- input.js, output.js, code.js. */
export default function CodeNodePanel(props: NodePanelProps) {
  return <NodeDefinition {...props} />;
}
