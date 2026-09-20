import { DANGER_TEXT, DIM, FIELD, TEXT } from '@/ui/theme';
import { parseInterval } from '@engine/execution/triggers.ts';
import type { NodePanelProps } from '../../NodeGuiBuilder';

export default function TriggerNodePanel({ node, setConfig }: NodePanelProps) {
  const every = String(node.config.trigger_every ?? '');
  // Said while it is being typed, in the engine's own words: the same function
  // reads this field when the tool runs, so what it rejects here it would
  // reject there -- at three in the morning, in a log nobody is reading.
  let problem = '';
  try {
    if (every.trim()) parseInterval(every);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  return (
    <div>
      <label className="flex items-center gap-2 text-sm mb-3" style={{ color: TEXT }}>
        <input
          type="checkbox"
          checked={node.config.trigger_on_start !== false}
          onChange={(e) => setConfig('trigger_on_start', e.target.checked)}
        />
        When the tool starts
      </label>
      <label className="flex items-center gap-2 text-sm" style={{ color: TEXT }}>
        <span>Again every</span>
        <input
          className="rounded-lg px-2 py-1 text-sm font-mono"
          style={{ ...FIELD, width: 90 }}
          value={every}
          onChange={(e) => setConfig('trigger_every', e.target.value)}
          placeholder="never"
          aria-label="Interval"
        />
        <span className="text-xs" style={{ color: problem ? DANGER_TEXT : DIM }}>
          {problem || '45, 30s, 5m, 2h or 1d — counted from the end of one round to the start of the next'}
        </span>
      </label>
      <p className="text-xs mt-3" style={{ color: DIM }}>
        It starts what its port is wired to — a node's input, or its ◆ — and wired to nothing, the whole
        graph. A deployed tool's server keeps the time, with nobody watching; on the command line the
        shortest interval applies and <code>--every</code> overrides it. In the editor nothing fires by
        itself: press ▶ Run, which counts every trigger as fired.
      </p>
    </div>
  );
}
