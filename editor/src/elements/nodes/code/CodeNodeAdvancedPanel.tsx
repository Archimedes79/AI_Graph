import RunOptions from '../../fields/RunOptions';
import type { NodeAdvancedPanelProps } from '../../NodeGuiBuilder';

/** The switches with good defaults, folded away under the body: see `AdvancedPanel`. */
export default function CodeNodeAdvancedPanel({ node, setConfig }: NodeAdvancedPanelProps) {
  return <RunOptions node={node} setConfig={setConfig} subject="code" />;
}
