import { LINE, MUTED, SURFACE } from '@/ui/theme';

/**
 * "⤓ Save" in the top-right corner of what a block shows -- a text, a chart,
 * rows -- for a block that has something to save (`download.ts` makes the
 * file). Drawn inside the element it saves the contents of, which is
 * `relative` and the hover `group`, and not scrolled with it.
 *
 * Out of sight until that element is pointed at, or the button is reached
 * with the keyboard: a page is for reading what it shows, and a button on
 * every block would be read first.
 */
export default function SaveButton({ title, onSave }: { title: string; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      title={title}
      aria-label={title}
      className="absolute top-1 right-1 z-10 rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      style={{ background: SURFACE, color: MUTED, border: `1px solid ${LINE}` }}
    >
      ⤓ Save
    </button>
  );
}
