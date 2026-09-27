import { DIM, DIMMER, FIELD, MUTED, NEUTRAL_BUTTON } from '@/ui/theme';

interface Props {
  /** What the person wrote: `output_format_prompt`. */
  words: string;
  onWords: (words: string) => void;
  /** What the graph around the node already says (`derivedOutputWords`), shown greyed while nothing is written. */
  derived: string;
  /** Who reads the words, and when: the element's own sentence. */
  hint?: string;
}

/**
 * Step 2's one words field: what comes out, said once.
 *
 * Empty, it shows what is derived from the graph -- what each wired node or
 * block wants, and the shape a run kept -- which is what ✨ is told anyway. So
 * the words are only for what the graph cannot say; "Use this" takes the
 * derived text in to start from. There used to be a format field, an example
 * box with "Use the last result", a description per output port and a "Use
 * this format" copy of a wired data node's format, all saying this.
 */
export default function OutputWordsField({ words, onWords, derived, hint }: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3">
        <label className="text-xs font-medium" style={{ color: MUTED }} htmlFor="what-comes-out">
          What comes out, in words
        </label>
        {derived && !words.trim() && (
          <button className="text-xs px-2 py-0.5 rounded" style={NEUTRAL_BUTTON} onClick={() => onWords(derived)}
            title="Take what the graph already says in, to change it">
            Use this
          </button>
        )}
      </div>
      {hint && <p className="text-xs mb-1.5" style={{ color: DIM }}>{hint}</p>}
      <textarea
        id="what-comes-out"
        className="w-full rounded-lg px-2 py-1.5 text-sm resize-y"
        style={{ ...FIELD, minHeight: 56 }}
        value={words}
        onChange={(event) => onWords(event.target.value)}
        placeholder={derived || 'In words — e.g. “A JSON list of {title, score}, best first” or “Two sentences, no heading”. Empty: plain text.'}
        aria-label="What comes out"
      />
      {derived && !words.trim() && (
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Greyed: what the graph around it already says. ✨ is told that either way; write only what it leaves out.
        </p>
      )}
    </div>
  );
}
