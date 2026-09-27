import NodeSteps from '@/authoring/NodeSteps';
import type { NodePanelProps } from '../../NodeGuiBuilder';

/** A code node: the four steps, its body the function `run(inputs)`. */
export default function CodeNodePanel(props: NodePanelProps) {
  return (
    <NodeSteps
      {...props}
      subject="this code"
      body={{
        title: 'Code',
        hint: 'A JavaScript function run(inputs) that returns the outputs. ✨ Generate writes it from steps 1 to 3, runs it on the example in step 1 -- or, while there is none, on what arrived last -- and repairs it once if it fails.',
      }}
    />
  );
}
