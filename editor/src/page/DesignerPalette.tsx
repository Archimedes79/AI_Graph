import React, { useState } from 'react';
import type { WidgetKind } from '@/graph';
import { DIMMER, LINE, SURFACE, TEXT } from '@/ui/theme';

/**
 * The element palette, in the same place and the same shape as the node palette
 * on the graph tab: a list on the left, click or drag to add.
 *
 * Grouped the way a page is built rather than by implementation: the words that
 * hold a page together, the things a person operates, the things a run fills in.
 *
 * An entry is a **kind plus a mode**, not just a kind. "Heading" and "Text" are
 * both `text` -- they hold the same string and contribute the same ports -- so
 * they are one element with two formats, and the palette is where that
 * distinction belongs: in front of the person choosing, not in the type system
 * behind them.
 *
 * What most pages are made of is on top; what a few pages need is under "More",
 * folded. Seventeen entries in a column was a list to read before starting,
 * and seven of them were ways to draw a line or leave a gap.
 */
export interface PaletteEntry {
  kind: WidgetKind;
  mode?: string;
  label: string;
  icon: string;
  /** Other words someone might type for this when searching. */
  also?: string;
}

interface PaletteGroup { label: string; entries: PaletteEntry[]; folded?: boolean }

export const PALETTE: PaletteGroup[] = [
  {
    label: 'Words',
    entries: [
      { kind: 'text', mode: 'heading', label: 'Heading', icon: '🔠', also: 'title h1' },
      { kind: 'text', mode: 'body', label: 'Text', icon: '📝', also: 'paragraph markdown body' },
      { kind: 'divider', mode: 'horizontal', label: 'Divider', icon: '➖', also: 'line rule hr' },
    ],
  },
  {
    label: 'The person does',
    entries: [
      { kind: 'chat', label: 'Chat', icon: '💬', also: 'conversation messages bot' },
      { kind: 'input_picker', label: 'File or folder', icon: '📂', also: 'picker open browse upload' },
      { kind: 'text_io', mode: 'input', label: 'Text input', icon: '⌨️', also: 'field box type prompt' },
      { kind: 'select', label: 'Dropdown', icon: '▾', also: 'select choice options' },
      { kind: 'slider', label: 'Slider', icon: '🎚️', also: 'number range' },
      { kind: 'button', label: 'Button', icon: '🔘', also: 'run start go trigger' },
    ],
  },
  {
    label: 'The graph shows',
    entries: [
      { kind: 'text_io', mode: 'output', label: 'Text output', icon: '📄', also: 'result answer display' },
      { kind: 'table', label: 'Table', icon: '▦', also: 'rows grid data' },
      { kind: 'plot_window', label: 'Chart', icon: '📊', also: 'plot graph diagram svg' },
      { kind: 'image_view', label: 'Image', icon: '🖼️', also: 'picture photo' },
    ],
  },
  {
    label: 'More',
    folded: true,
    entries: [
      { kind: 'text', mode: 'caption', label: 'Caption', icon: '🏷️', also: 'small note' },
      { kind: 'text_io', mode: 'both', label: 'Text in & out', icon: '↔️', also: 'both editable' },
      { kind: 'divider', mode: 'vertical', label: 'Vertical divider', icon: '│' },
      { kind: 'spacer', mode: 'horizontal', label: 'Gap', icon: '␣', also: 'space spacer' },
      { kind: 'spacer', mode: 'vertical', label: 'Vertical gap', icon: '┆' },
    ],
  },
];

/** Every entry, for the quick-insert menu: one list, searched by what people call things. */
export const ALL_ENTRIES: PaletteEntry[] = PALETTE.flatMap((group) => group.entries);

export function matchesEntry(entry: PaletteEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.label} ${entry.also ?? ''} ${entry.kind}`.toLowerCase().includes(needle);
}

export default function DesignerPalette({
  onAdd, onDragStart,
}: {
  onAdd: (kind: WidgetKind, mode?: string) => void;
  /** Begin a pointer drag of a new element; the surface decides where it lands. */
  onDragStart: (entry: PaletteEntry, event: React.MouseEvent) => void;
}) {
  const [more, setMore] = useState(false);

  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{ width: 200, background: SURFACE, borderRight: `1px solid ${LINE}`, flexShrink: 0 }}
    >
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#818cf8' }}>
          Blocks
        </h2>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>
          Click or drag — or press <kbd>/</kbd> on the page
        </p>
      </div>

      {PALETTE.map((group) => {
        const open = !group.folded || more;
        return (
          <div key={group.label} className="py-2">
            <h3
              className="px-4 text-xs font-medium uppercase tracking-wider mb-1 select-none"
              style={{ color: DIMMER, cursor: group.folded ? 'pointer' : 'default' }}
              onClick={group.folded ? () => setMore((was) => !was) : undefined}
            >
              {group.folded ? `${more ? '▾' : '▸'} ${group.label}` : group.label}
            </h3>
            {open && group.entries.map((entry) => (
              <button
                key={`${entry.kind}:${entry.mode ?? ''}`}
                className="w-full flex items-center gap-3 px-4 py-1.5 text-sm text-left transition-colors hover-raise"
                style={{ color: TEXT }}
                onClick={() => onAdd(entry.kind, entry.mode)}
                // Without preventDefault the browser starts a text selection instead,
                // which looks exactly like a drag that does nothing.
                onMouseDown={(e) => { e.preventDefault(); onDragStart(entry, e); }}
                title={entry.label}
              >
                <span className="text-base w-5 text-center">{entry.icon}</span>
                <span className="truncate">{entry.label}</span>
              </button>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
