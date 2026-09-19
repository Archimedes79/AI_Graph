import { DIMMER, FIELD, LINE, MUTED, PRIMARY_BUTTON } from '@/ui/theme';
import { useGraphStore } from '@/store/graphStore';
import { SubgraphNodeElement } from '@engine/elements/nodes/subgraph/SubgraphNodeElement.ts';
import type { NodePanelProps } from '../../NodeUi';

const ELEMENT = new SubgraphNodeElement();

/**
 * What there is to say about a node that holds a graph, which is not much:
 * what it is for, and what it has at its edges.
 *
 * The ports are a *view*. They are the input and output nodes of the graph
 * inside, so they are added, renamed and removed in there, with the same
 * palette and the same undo as any other node. A second way to edit them here
 * would be a second place for them to live.
 */
export default function SubgraphNodePanel({ node, setConfig }: NodePanelProps) {
  const ports = ELEMENT.derivedPorts(node as never) ?? { inputs: [], outputs: [] };
  const inner = ELEMENT.nestedGraph(node as never);
  const count = inner?.nodes.length ?? 0;

  /**
   * In. The draft is taken first -- as "open in your own editor" does -- and
   * then the dialog goes, because what is behind it is about to be a
   * different graph.
   */
  const enter = () => {
    const store = useGraphStore.getState();
    store.updateNode(node.id, node);
    store.setEditingNode(null);
    store.openSubgraph(node.id);
  };

  return (
    <div>
      <button
        type="button"
        className="w-full mb-4 px-3 py-2 rounded-lg text-sm font-medium"
        style={PRIMARY_BUTTON}
        onClick={enter}
      >
        Open this graph ▸
      </button>
      <div className="mb-4">
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          What this part is meant to do
        </label>
        <textarea
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={FIELD}
          rows={3}
          value={node.config.task ?? ''}
          onChange={(e) => setConfig('task', e.target.value)}
          placeholder="e.g. Take a paper, and give back a one-paragraph summary and a verdict"
        />
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          A subgraph may be nothing but this sentence to begin with; the graph comes later.
        </p>
      </div>

      <div className="pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
        <label className="block text-xs font-medium mb-1" style={{ color: MUTED }}>
          Ports — the input and output nodes of the graph inside
        </label>
        {ports.inputs.length + ports.outputs.length === 0 ? (
          <p className="text-xs" style={{ color: DIMMER }}>
            None yet. Open it, and every input node you add in there is an input here, every
            output node an output.
          </p>
        ) : (
          <ul className="text-sm space-y-1">
            {ports.inputs.map((port) => (
              <li key={port.id} style={{ color: MUTED }}>← {port.name}</li>
            ))}
            {ports.outputs.map((port) => (
              <li key={port.id} style={{ color: MUTED }}>→ {port.name}</li>
            ))}
          </ul>
        )}
        <p className="text-xs mt-2" style={{ color: DIMMER }}>
          {count === 0 ? 'The graph inside is empty.' : `The graph inside has ${count} node${count === 1 ? '' : 's'}.`}
        </p>
      </div>
    </div>
  );
}
