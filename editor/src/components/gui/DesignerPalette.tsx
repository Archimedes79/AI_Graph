import React from 'react';
import type { GuiWidgetKind } from '../../types/graph';
import { DIMMER, LINE, SURFACE, TEXT } from '../../ui/theme';

/**
 * The element palette, in the same place and the same shape as the node palette
 * on the graph tab: a list on the left, click or drag to add.
 *
 * Grouped the way a page is built rather than by implementation: the furniture
 * that holds a page together, the fields a person operates, the displays a run
 * fills in.
 *
 * An entry is a **kind plus a mode**, not just a kind. "Überschrift" and
 * "Fließtext" are both `text` -- they hold the same string and contribute the
 * same ports -- so they are one element with two formats, and the palette is
 * where that distinction belongs: in front of the person choosing, not in the
 * type system behind them.
 */
export interface PaletteEntry {
  kind: GuiWidgetKind;
  mode?: string;
  label: string;
  icon: string;
}

const GROUPS: { label: string; entries: PaletteEntry[] }[] = [
  {
    label: 'Seite',
    entries: [
      { kind: 'text', mode: 'heading', label: 'Überschrift', icon: '🔠' },
      { kind: 'text', mode: 'body', label: 'Fließtext', icon: '📝' },
      { kind: 'text', mode: 'caption', label: 'Bildunterschrift', icon: '🏷️' },
      { kind: 'divider', mode: 'horizontal', label: 'Linie waagerecht', icon: '➖' },
      { kind: 'divider', mode: 'vertical', label: 'Linie senkrecht', icon: '│' },
      { kind: 'spacer', mode: 'horizontal', label: 'Abstand waagerecht', icon: '␣' },
      { kind: 'spacer', mode: 'vertical', label: 'Abstand senkrecht', icon: '┆' },
    ],
  },
  {
    label: 'Eingabe',
    entries: [
      { kind: 'input_picker', label: 'Datei-/Ordnerauswahl', icon: '📂' },
      { kind: 'text_io', mode: 'input', label: 'Texteingabe', icon: '⌨️' },
      { kind: 'text_io', mode: 'both', label: 'Chat (ein & aus)', icon: '💬' },
    ],
  },
  {
    label: 'Anzeige',
    entries: [
      { kind: 'text_io', mode: 'output', label: 'Textausgabe', icon: '📄' },
      { kind: 'table', label: 'Tabelle', icon: '▦' },
      { kind: 'plot_window', label: 'Diagramm', icon: '📊' },
      { kind: 'image_view', label: 'Bild', icon: '🖼️' },
    ],
  },
];

export default function DesignerPalette({
  onAdd, onDragStart,
}: {
  onAdd: (kind: GuiWidgetKind, mode?: string) => void;
  /** Begin a pointer drag of a new element; the surface decides where it lands. */
  onDragStart: (entry: PaletteEntry, event: React.MouseEvent) => void;
}) {
  return (
    <aside
      className="flex flex-col h-full overflow-y-auto"
      style={{ width: 220, background: SURFACE, borderRight: `1px solid ${LINE}`, flexShrink: 0 }}
    >
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#818cf8' }}>
          Elemente
        </h2>
        <p className="text-xs mt-1" style={{ color: DIMMER }}>Ziehen oder klicken</p>
      </div>

      {GROUPS.map((group) => (
        <div key={group.label} className="py-2">
          <h3 className="px-4 text-xs font-medium uppercase tracking-wider mb-1" style={{ color: DIMMER }}>
            {group.label}
          </h3>
          {group.entries.map((entry) => (
            <button
              key={`${entry.kind}:${entry.mode ?? ''}`}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors hover-raise"
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
      ))}

      <div className="mt-auto px-4 py-4" style={{ borderTop: `1px solid ${LINE}` }}>
        <p className="text-xs" style={{ color: DIMMER }}>
          Die Reihenfolge ist die Position. Am Griff links ziehen zum Umsortieren,
          Entf löscht, die Ecke ändert die Größe.
        </p>
      </div>
    </aside>
  );
}
