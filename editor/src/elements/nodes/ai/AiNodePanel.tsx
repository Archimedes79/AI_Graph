import NodeDefinition from '@/authoring/NodeDefinition';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/**
 * An ai node: its text, and what ✨ writes from it -- input.js, output.js and
 * prompt.md, the instructions its model is given. Everything that is a knob
 * rather than a sentence is in `AiNodeAdvancedPanel`, folded away below.
 */
export default function AiNodePanel(props: NodePanelProps) {
  return <NodeDefinition {...props} />;
}
