import type { GraphNode } from '@/graph';
import SidePanel from '@/ui/SidePanel';
import { DIM, MUTED, PRIMARY_BUTTON, TEXT } from '@/ui/theme';
import NodeKind from './NodeKind';

/**
 * The panel of the page's card. The page is built on the Page tab -- at the
 * size it will be, beside the blocks it will sit next to -- so its panel is
 * the way there, not a second place to build it through a keyhole.
 */
export default function PageCardPanel({ node, onClose, onOpenPage }: {
  node: GraphNode;
  onClose: () => void;
  onOpenPage: () => void;
}) {
  return (
    <SidePanel
      kicker={<NodeKind node={node} />}
      title={<div className="truncate text-lg font-bold" style={{ color: TEXT }}>{node.label}</div>}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
          What the tool shows: its blocks, what each of them hands on and what each shows. It is built on the
          Page tab, block by block, at the size it will be.
        </p>
        <button type="button" onClick={onOpenPage} className="self-start rounded-lg px-3 py-1.5 text-sm font-semibold" style={PRIMARY_BUTTON}>
          Open the Page tab
        </button>
        <p className="text-xs" style={{ color: DIM }}>Double-clicking the page on the canvas opens it too.</p>
      </div>
    </SidePanel>
  );
}
