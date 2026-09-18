import React, { useMemo } from 'react';
import type { GraphNode } from '../../types/graph';
import { useGraphStore } from '../../store/graphStore';
import { call } from '../../utils/api';
import { connectedFormatContext, lastRunContext, lastRunInputs } from './generationContext';
import TryItPanel, { type TryResult } from './TryItPanel';

/**
 * `TryItPanel` for a node: the node as it stands in the dialog, run by itself.
 *
 * The graph sent along is the one on the canvas with *this* node swapped for
 * the draft being edited, because the point is to try what has not been saved
 * yet -- the prompt as just reworded, the body as just generated.
 */
export default function NodeTryIt({ node, title, children, renderResult, testLabel }: {
  node: GraphNode;
  title: string;
  children?: React.ReactNode;
  renderResult?: (result: TryResult) => React.ReactNode;
  testLabel?: string;
}) {
  const executionResult = useGraphStore((s) => s.executionResult);
  const exportGraph = useGraphStore((s) => s.exportGraph);
  const rfEdges = useGraphStore((s) => s.rfEdges);
  const rfNodes = useGraphStore((s) => s.rfNodes);
  const observed = useMemo(() => lastRunInputs(node.id, executionResult) ?? {}, [node.id, executionResult]);

  const graphWithDraft = () => {
    const graph = exportGraph();
    graph.nodes = graph.nodes.map((n) => (n.id === node.id ? node : n));
    return graph;
  };

  const context = [
    connectedFormatContext(node.id, rfNodes.map((n) => n.data.graphNode), rfEdges),
    lastRunContext(node.id, executionResult),
  ].filter(Boolean).join('\n\n');

  return (
    <TryItPanel
      subject={node.id}
      title={title}
      ports={node.inputs.map((port) => ({ id: port.id, name: port.name }))}
      observed={observed}
      onFetch={() => call('nodeInputs', { ...graphWithDraft(), node_id: node.id })}
      onTest={(values) => call('runNode', { ...graphWithDraft(), node_id: node.id, inputs: values })}
      renderResult={renderResult}
      context={context}
      testLabel={testLabel}
    >
      {children}
    </TryItPanel>
  );
}
