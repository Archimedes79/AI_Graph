import RunCode from '@/authoring/RunCode';
import { GRAPH_RUNS_PER_BODY, SUBGRAPH_RUN, isStandardGraphRun } from '@engine/elements/nodes/subgraph/runTemplate.ts';
import type { NodeAdvancedPanelProps } from '../../NodeGuiBuilder';

/** How the graph inside is run: once, as it comes, or as a run.js of your own says. */
export default function SubgraphNodeAdvancedPanel({ node, setConfig }: NodeAdvancedPanelProps) {
  const code = String(node.config.run_code ?? '');
  return (
    <RunCode code={code} standard={SUBGRAPH_RUN} isStandard={isStandardGraphRun} onChange={(next) => setConfig('run_code', next)}>
      One run of the graph inside. Change it to run the graph once per item, again until an answer passes a
      check, or one run's outputs into the next: <code>await node.graph(&#123; port: value &#125;)</code> runs it
      and resolves to its outputs, at most {GRAPH_RUNS_PER_BODY} times a run. The ports are named after the
      input and output nodes inside.
    </RunCode>
  );
}
