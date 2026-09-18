import { useEffect, useRef, useState } from 'react';
import { ALL_ENTRIES, matchesEntry, type PaletteEntry } from './DesignerPalette';
import { ACCENT, ACCENT_FILL, DIMMER, FIELD, LINE, SURFACE, TEXT } from '../../ui/theme';

/**
 * "/" on the page: type what you want, press Enter, keep going.
 *
 * The palette is for finding out what exists. This is for when you know --
 * `/` `but` `Enter` puts a button where you were, without the hand leaving the
 * keyboard or the eye leaving the page. It is the one thing every document
 * editor people call easy has in common, and it searches by what people call
 * things ("run" finds the button, "title" the heading) rather than by our names
 * for them.
 */
export default function QuickInsert({ onPick, onClose }: {
  onPick: (entry: PaletteEntry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement | null>(null);
  const found = ALL_ENTRIES.filter((entry) => matchesEntry(entry, query));

  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => { setAt(0); }, [query]);

  return (
    <div
      className="rounded-lg shadow-lg"
      style={{ width: 280, background: SURFACE, border: `1px solid ${ACCENT}`, gridColumn: 'span 16', justifySelf: 'start' }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <input
        ref={box}
        className="w-full rounded-t-lg px-3 py-2 text-sm outline-none"
        style={{ ...FIELD, border: 'none', borderBottom: `1px solid ${LINE}` }}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Add a block… heading, button, chart"
        aria-label="Search blocks"
        onBlur={onClose}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); setAt((was) => Math.min(found.length - 1, was + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setAt((was) => Math.max(0, was - 1)); }
          if (event.key === 'Enter' && found[at]) { event.preventDefault(); onPick(found[at]); }
        }}
      />
      <div className="py-1 overflow-y-auto" style={{ maxHeight: 260 }}>
        {found.length === 0 && (
          <p className="px-3 py-2 text-xs" style={{ color: DIMMER }}>Nothing is called that.</p>
        )}
        {found.map((entry, index) => (
          <button
            key={`${entry.kind}:${entry.mode ?? ''}`}
            className="w-full flex items-center gap-3 px-3 py-1.5 text-sm text-left"
            style={{ color: TEXT, background: index === at ? ACCENT_FILL : 'transparent' }}
            // mousedown, not click: the input's blur closes the menu before a click lands.
            onMouseDown={(event) => { event.preventDefault(); onPick(entry); }}
            onMouseEnter={() => setAt(index)}
          >
            <span className="w-5 text-center">{entry.icon}</span>
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
