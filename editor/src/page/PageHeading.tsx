import type { GraphMetadata } from '@/graph';
import { FIELD_ON_SURFACE, LINE, MUTED, SURFACE } from '@/ui/theme';

/** A change to what the tool is called, or to what it does. */
type ToolWords = Partial<Pick<GraphMetadata, 'name' | 'description'>>;

/**
 * Above the page being built: the tool's name and what it does -- the graph's
 * own, which the delivered tool shows in its header, above the same page.
 *
 * The page had a name and an "About" of its own, on its node, beside the
 * graph's: two names for one tool, while the graph's description, the one a
 * recipient reads, could be set nowhere at all. A graph has one page, so the
 * page is called what the graph is called.
 */
export default function PageHeading({ name, description, onChange }: {
  name: string;
  description: string;
  onChange: (words: ToolWords) => void;
}) {
  return (
    <header
      className="px-8 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 shrink-0"
      style={{ background: SURFACE, borderBottom: `1px solid ${LINE}` }}
    >
      <input
        className="rounded px-2 py-1 text-sm font-semibold"
        style={{ ...FIELD_ON_SURFACE, width: '16rem' }}
        value={name}
        aria-label="Name of the tool"
        placeholder="Name of the tool"
        title="What this tool is called: in the header of the page, here and for whoever gets it"
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <input
        className="flex-1 min-w-0 rounded px-2 py-1 text-xs"
        style={{ ...FIELD_ON_SURFACE, minWidth: '16rem', color: MUTED }}
        value={description}
        aria-label="What the tool does"
        placeholder="What this tool does, in a sentence — shown under its name (optional)"
        title="The graph's description: shown under the tool's name, here and for whoever gets it"
        onChange={(e) => onChange({ description: e.target.value })}
      />
    </header>
  );
}
