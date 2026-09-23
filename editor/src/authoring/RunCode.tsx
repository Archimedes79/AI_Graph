import type { ReactNode } from 'react';
import CodeField from './CodeField';
import { DIMMER, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

/**
 * `run.js`: what a node does when it runs, as the project folder keeps it.
 *
 * Shown whether or not anyone wrote it, because "what does this node actually
 * do" is a question the folder should answer. Left as it is, it is the
 * engine's and follows the engine; changed, it is a body like a code node's --
 * sandboxed, without this machine's keys, asking for its calls. An ai node's
 * asks `node.llm`, a subgraph node's `node.graph`.
 */
export default function RunCode({ code, standard, isStandard, onChange, children }: {
  code: string;
  /** Today's standard text, shown while nobody has changed it. */
  standard: string;
  isStandard: (code: string) => boolean;
  onChange: (code: string) => void;
  /** What the standard does and what a changed one may ask, in a sentence or two. */
  children: ReactNode;
}) {
  const own = !isStandard(code);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="block text-xs font-medium" style={{ color: MUTED }}>
          What this node runs <span style={{ color: DIMMER }}>— run.js{own ? ', changed by you' : ', the standard'}</span>
        </label>
        {own && (
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => onChange('')}>
            Back to the standard
          </button>
        )}
      </div>
      <CodeField value={own ? code : standard} onChange={onChange} language="javascript" minHeight={150} title="run.js" />
      <p className="text-xs mt-1" style={{ color: DIMMER }}>{children}</p>
    </div>
  );
}
