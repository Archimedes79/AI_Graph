import { DANGER_TEXT, DIMMER, FIELD, LINE, MUTED, PRIMARY_BUTTON } from '@/ui/theme';
import { useGraphStore } from '@/store/graphStore';
import { SubgraphNodeElement } from '@engine/elements/nodes/subgraph/SubgraphNodeElement.ts';
import { registry as engineRegistry } from '@engine/elements/registry.ts';
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
  const ports = ELEMENT.derivedPorts(node as never, engineRegistry) ?? { inputs: [], outputs: [] };
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
      {inner ? (
        <button
          type="button"
          className="w-full mb-4 px-3 py-2 rounded-lg text-sm font-medium"
          style={PRIMARY_BUTTON}
          onClick={enter}
        >
          Open this graph ▸
        </button>
      ) : (
        // A button that closes the dialog and opens nothing is worse than no
        // button: this is the one case it cannot do its job, and it says so.
        <p className="mb-4 text-sm" style={{ color: DANGER_TEXT }}>
          The graph this node holds cannot be read. Open its <code>graph.json</code> under the project&apos;s{' '}
          <code>nodes/</code> folder and fix it, or delete the node and build it again.
        </p>
      )}
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

      {/* The one setting this node has of its own. It matters more here than
          elsewhere: anything short of a clean run inside fails this node, so
          this is how the graph above is allowed to carry on regardless. */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm" style={{ color: MUTED }}>
          <input
            type="checkbox"
            checked={node.config.catch_errors === true}
            onChange={(e) => setConfig('catch_errors', e.target.checked)}
          />
          Catch a failed run instead of ending this one
        </label>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Off, a failure anywhere in the graph inside stops the run out here. On, this node
          grows an <strong style={{ color: '#a78bfa' }}>Error</strong> output carrying the
          reason, its other outputs carry nothing, and the run goes on.
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
