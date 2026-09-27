import { useMemo } from 'react';
import type { Graph } from '@/graph';
import { parseGraph } from '@engine/graph.ts';
import { problemsIn, type Problem } from '@engine/project/check.ts';
import { TEXT } from '@/ui/theme';

/** What `check` says of *graph*: its problems -- or, when it cannot be read as one, that. */
function problemsOf(graph: Graph): Problem[] {
  try {
    return problemsIn(parseGraph(graph));
  } catch (error) {
    return [{ where: 'graph', problem: error instanceof Error ? error.message : String(error), fix: 'Fix the graph so it can be read.' }];
  }
}

/**
 * What `check` finds in a graph about to be loaded from outside -- one ✨ AI
 * Graph designed, one pasted as JSON -- said before Load. A graph with two
 * pages was loaded without a word, and the second page's blocks could then
 * be neither seen nor changed nor removed.
 */
export default function GraphProblems({ graph }: { graph: Graph }) {
  const problems = useMemo(() => problemsOf(graph), [graph]);
  if (!problems.length) return null;
  return (
    <div className="text-xs px-3 py-2 rounded space-y-1" style={{ background: 'rgba(234,179,8,0.08)', color: '#fcd34d' }} role="status">
      <p className="font-medium">
        ⚠ {problems.length === 1 ? 'This graph has a problem' : `This graph has ${problems.length} problems`}. Load takes it as it is.
      </p>
      <ul className="space-y-1">
        {problems.map((problem, index) => (
          <li key={index}>
            <span style={{ color: TEXT }}>{problem.where}</span>: {problem.problem} {problem.fix}
          </li>
        ))}
      </ul>
    </div>
  );
}
