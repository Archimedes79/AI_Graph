import RunOptions from '../../fields/RunOptions';
import RunOncePerItem from '../../fields/RunOncePerItem';
import type { NodeAdvancedPanelProps } from '../../NodeGuiBuilder';

/** Its ports and the switches with good defaults, folded away under what it does: see `AdvancedPanel`. */
export default function CodeNodeAdvancedPanel({ node, setConfig, updateNode, ports }: NodeAdvancedPanelProps) {
  return (
    <>
      {ports}
      <RunOncePerItem node={node} updateNode={updateNode} subject="this code" />
      <RunOptions node={node} setConfig={setConfig} subject="code" />
    </>
  );
}
